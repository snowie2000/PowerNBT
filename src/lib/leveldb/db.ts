/**
 * BedrockLevelDB  thin proxy over the real LevelDB native module.
 *
 * ARCHITECTURE: Only keys are loaded on open (values are tiny ~8-20 bytes each).
 * Values are fetched lazily via IPC only when the user opens a specific key.
 * This makes opening a 200MB world as fast as opening a 1MB world.
 */

import { SINGLETON_KEYS, NBT_KEY_PREFIXES } from './minecraft'

//  Public types 

export interface LevelDBEntry {
  key: Uint8Array
  value: Uint8Array
}

//  BedrockLevelDB 

export class BedrockLevelDB {
  readonly dirPath: string

  /** Known key set — populated on open. Values are NOT preloaded. */
  private entries: Set<string> = new Set()
  /** Writes staged since last flush. null = deletion. */
  private pendingWrites: Map<string, Uint8Array | null> = new Map()
  private isOpen = false

  constructor(dirPath: string) {
    this.dirPath = dirPath.replace(/\\/g, '/')
  }

  //  open 

  async open(): Promise<void> {
    await window.electronAPI.leveldb.open(this.dirPath)

    this.entries.clear()

    // 1. Probe all fixed singleton keys in one IPC round-trip
    const singletonBytes = SINGLETON_KEYS.map(k => Array.from(new TextEncoder().encode(k)))
    const foundSingletons = await window.electronAPI.leveldb.probeKeys(this.dirPath, singletonBytes)
    for (const k of foundSingletons) {
      this.entries.add(keyStr(new Uint8Array(k)))
    }

    // 2. Range-scan each NBT key prefix (player_, map_, VILLAGE_, etc.)
    for (const prefix of NBT_KEY_PREFIXES) {
      const prefixBytes = Array.from(new TextEncoder().encode(prefix))
      const keys = await window.electronAPI.leveldb.getKeysWithPrefix(this.dirPath, prefixBytes)
      for (const k of keys) {
        this.entries.add(keyStr(new Uint8Array(k)))
      }
    }

    this.isOpen = true
    console.debug(`[LevelDB] Opened: ${this.dirPath}  (${this.entries.size} NBT keys)`)
  }

  //  Sync existence check 

  has(key: Uint8Array): boolean {
    const k = keyStr(key)
    if (this.pendingWrites.has(k)) return this.pendingWrites.get(k) !== null
    return this.entries.has(k)
  }

  //  Async value fetch 

  async get(key: Uint8Array): Promise<Uint8Array | null> {
    const k = keyStr(key)
    if (this.pendingWrites.has(k)) return this.pendingWrites.get(k) ?? null
    if (!this.entries.has(k)) return null
    const result = await window.electronAPI.leveldb.get(this.dirPath, Array.from(key))
    return result ? new Uint8Array(result) : null
  }

  put(key: Uint8Array, value: Uint8Array): void {
    this.pendingWrites.set(keyStr(key), value)
  }

  delete(key: Uint8Array): void {
    this.pendingWrites.set(keyStr(key), null)
  }

  /** Yields known keys (excluding pending deletions). Values are NOT included. */
  *iterate(): Generator<Uint8Array> {
    const seen = new Set<string>()
    for (const [k, v] of this.pendingWrites) {
      if (v !== null) { yield strToKey(k); seen.add(k) }
    }
    for (const k of this.entries) {
      if (!seen.has(k) && this.pendingWrites.get(k) !== null) {
        yield strToKey(k)
      }
    }
  }

  //  Flush 

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

    // Commit to in-memory key set
    for (const [k, v] of this.pendingWrites) {
      if (v !== null) this.entries.add(k)
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
