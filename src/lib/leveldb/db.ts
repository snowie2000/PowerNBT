/**
 * BedrockLevelDB  thin proxy over the real LevelDB native module.
 *
 * All heavy lifting (SST parsing, WAL writing, CRC32C, manifest parsing) is gone.
 * The native `leveldb-zlib` module runs in the Electron main process and is
 * accessed via IPC through window.electronAPI.leveldb.
 *
 * Public interface is unchanged so no callers need to be updated.
 */

//  Public types 

export interface LevelDBEntry {
  key: Uint8Array
  value: Uint8Array
}

//  BedrockLevelDB 

export class BedrockLevelDB {
  readonly dirPath: string

  /** In-memory snapshot, loaded on open and kept up-to-date on flush. */
  private entries: Map<string, Uint8Array> = new Map()
  /** Writes staged since last flush. null = deletion. */
  private pendingWrites: Map<string, Uint8Array | null> = new Map()
  private isOpen = false

  constructor(dirPath: string) {
    this.dirPath = dirPath.replace(/\\/g, '/')
  }

  //  open 

  async open(): Promise<void> {
    await window.electronAPI.leveldb.open(this.dirPath)

    // Snapshot all existing key-value pairs into memory so get() stays sync
    // and the tree viewer can enumerate keys instantly.
    const all = await window.electronAPI.leveldb.readAll(this.dirPath)
    this.entries.clear()
    for (const entry of all) {
      const key = new Uint8Array(entry.key)
      const value = new Uint8Array(entry.value)
      this.entries.set(keyStr(key), value)
    }
    this.isOpen = true
    console.debug(`[LevelDB] Opened: ${this.dirPath}  (${this.entries.size} keys)`)
  }

  //  Sync read / stage write 

  get(key: Uint8Array): Uint8Array | null {
    const k = keyStr(key)
    // Pending writes take precedence over the snapshot
    if (this.pendingWrites.has(k)) return this.pendingWrites.get(k) ?? null
    return this.entries.get(k) ?? null
  }

  put(key: Uint8Array, value: Uint8Array): void {
    this.pendingWrites.set(keyStr(key), value)
  }

  delete(key: Uint8Array): void {
    this.pendingWrites.set(keyStr(key), null)
  }

  *iterate(): Generator<LevelDBEntry> {
    const seen = new Set<string>()
    for (const [k, v] of this.pendingWrites) {
      if (v !== null) { yield { key: strToKey(k), value: v }; seen.add(k) }
    }
    for (const [k, v] of this.entries) {
      if (!seen.has(k) && this.pendingWrites.get(k) !== null) {
        yield { key: strToKey(k), value: v }
      }
    }
  }

  //  Flush 

  /** Persist all staged writes atomically via a LevelDB batch write. */
  async flush(): Promise<void> {
    if (this.pendingWrites.size === 0) {
      console.log('[LevelDB flush] nothing pending')
      return
    }
    if (!this.isOpen) throw new Error('DB not open')

    const ops: Array<{ type: 'put' | 'del'; key: number[]; value?: number[] }> = []
    for (const [k, v] of this.pendingWrites) {
      const key = Array.from(strToKey(k))
      if (v !== null) {
        ops.push({ type: 'put', key, value: Array.from(v) })
      } else {
        ops.push({ type: 'del', key })
      }
    }

    await window.electronAPI.leveldb.batch(this.dirPath, ops)

    // Commit to in-memory snapshot
    for (const [k, v] of this.pendingWrites) {
      if (v !== null) this.entries.set(k, v)
      else this.entries.delete(k)
    }
    this.pendingWrites.clear()
    console.log(`[LevelDB flush] Wrote ${ops.length} key(s) to ${this.dirPath}`)
  }

  //  Close 

  async close(): Promise<void> {
    await this.flush()
    await window.electronAPI.leveldb.close(this.dirPath)
    this.isOpen = false
  }
}

//  Key serialisation 

function keyStr(key: Uint8Array): string {
  return JSON.stringify(Array.from(key))
}

function strToKey(s: string): Uint8Array {
  return new Uint8Array(JSON.parse(s) as number[])
}
