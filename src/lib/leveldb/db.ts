import { parseManifest } from './manifest'
import { parseTable } from './table'
import type { KVEntry } from './block'
import { parseLogFile } from './log'
import { encodeVarInt32 } from './varint'

type DirHandle = FileSystemDirectoryHandle

export interface LevelDBEntry {
  key: Uint8Array
  value: Uint8Array
}

async function readFileBytes(dir: DirHandle, name: string): Promise<Uint8Array | null> {
  try {
    const fh = await dir.getFileHandle(name)
    const file = await fh.getFile()
    return new Uint8Array(await file.arrayBuffer())
  } catch {
    return null
  }
}

function zeroPadded(n: number, digits: number): string {
  return String(n).padStart(digits, '0')
}

/**
 * Read-write interface to a Minecraft Bedrock LevelDB world store.
 *
 * Usage:
 *   const db = new BedrockLevelDB(dirHandle)
 *   await db.open()
 *   const value = await db.get(key)
 *   await db.put(key, value)
 *   await db.close()
 */
export class BedrockLevelDB {
  private dir: DirHandle
  private entries: Map<string, Uint8Array> = new Map()
  private pendingWrites: Map<string, Uint8Array | null> = new Map()
  private logHandle: FileSystemFileHandle | null = null
  private currentSequence = 0n

  constructor(dir: DirHandle) {
    this.dir = dir
  }

  /** Load all data from the LevelDB directory into memory */
  async open(): Promise<void> {
    // 0. List directory contents for diagnostics
    try {
      const fileNames: string[] = []
      // FileSystemDirectoryHandle supports .keys() async iterator per spec
      const dirAny = this.dir as unknown as { keys(): AsyncIterable<string> }
      for await (const name of dirAny.keys()) fileNames.push(name)
      console.debug(`[LevelDB] Directory "${this.dir.name}" contains: ${fileNames.sort().join(', ')}`)
    } catch {
      console.debug(`[LevelDB] Directory "${this.dir.name}" (could not list files)`)
    }

    // 1. Find MANIFEST via CURRENT file
    const currentBuf = await readFileBytes(this.dir, 'CURRENT')
    if (!currentBuf) throw new Error('No CURRENT file found – is this a valid LevelDB directory?')

    const currentText = new TextDecoder().decode(currentBuf).trim()
    const manifestName = currentText
    console.debug(`[LevelDB] CURRENT -> ${manifestName}`)
    const manifestBuf = await readFileBytes(this.dir, manifestName)
    if (!manifestBuf) throw new Error(`Could not read ${manifestName}`)

    // 2. Parse MANIFEST to find active SST files
    const { activeFiles, lastLogNumber } = parseManifest(manifestBuf)
    console.debug(`[LevelDB] Manifest: ${activeFiles.length} SST file(s), lastLogNumber=${lastLogNumber}`)

    // 3. Enumerate ALL .ldb files actually present on disk
    const diskLdbFiles: string[] = []
    try {
      const dirAny = this.dir as unknown as { keys(): AsyncIterable<string> }
      for await (const name of dirAny.keys()) {
        if (name.endsWith('.ldb')) diskLdbFiles.push(name)
      }
    } catch { /* ignore listing errors */ }
    diskLdbFiles.sort() // lexicographic = numeric order for zero-padded names

    const manifestFileNumbers = new Set(activeFiles.map(f => f.fileNumber))

    // Helper to load one .ldb file into sstEntries
    const loadLdb = async (name: string, label: string) => {
      const buf = await readFileBytes(this.dir, name)
      if (!buf) { console.warn(`[LevelDB] Missing file: ${name}`); return }
      try {
        const fileEntries = parseTable(buf)
        console.debug(`[LevelDB] ${label}${name}: ${fileEntries.length} entries`)
        sstEntries.push(...fileEntries)
      } catch (e) {
        console.error(`[LevelDB] Failed to parse ${name}:`, e)
      }
    }

    // 4. Load manifest-listed files first (oldest data — lower levels first so
    //    higher level 0 files can overwrite during map build).
    const sstEntries: KVEntry[] = []
    const sortedFiles = [...activeFiles].sort((a, b) => b.level - a.level || a.fileNumber - b.fileNumber)
    for (const meta of sortedFiles) {
      await loadLdb(zeroPadded(meta.fileNumber, 6) + '.ldb', 'manifest ')
    }

    // 5. Load any .ldb files on disk that the manifest doesn't list.
    //    These are post-compaction outputs whose VersionEdit was not parsed
    //    (Bedrock uses extended tags our parser stops at). They are newer than
    //    the manifest-listed files, so loading them last lets them override.
    const unlistedLdbs = diskLdbFiles.filter(name => {
      const num = parseInt(name, 10)
      return !manifestFileNumbers.has(num)
    })
    if (unlistedLdbs.length > 0) {
      console.debug(`[LevelDB] Loading ${unlistedLdbs.length} unlisted .ldb file(s): ${unlistedLdbs.join(', ')}`)
      for (const name of unlistedLdbs) {
        await loadLdb(name, 'unlisted ')
      }
    }

    // 6. Build in-memory map — later entries (higher file numbers) overwrite earlier ones
    for (const e of sstEntries) {
      this.entries.set(keyToString(e.key), e.value)
    }
    console.debug(`[LevelDB] SST total: ${this.entries.size} unique keys`)

    // 5. Apply log file (most recent, uncommitted writes)
    const logName = zeroPadded(lastLogNumber, 6) + '.log'
    const logBuf = await readFileBytes(this.dir, logName)
    if (logBuf) {
      const batches = parseLogFile(logBuf)
      console.debug(`[LevelDB] WAL ${logName}: ${batches.length} batch(es)`)
      for (const batch of batches) {
        if (batch.sequence > this.currentSequence) this.currentSequence = batch.sequence
        for (const entry of batch.entries) {
          const k = keyToString(entry.key)
          if (entry.type === 'put' && entry.value != null) {
            this.entries.set(k, entry.value)
          } else if (entry.type === 'delete') {
            this.entries.delete(k)
          }
        }
      }
    } else {
      console.debug(`[LevelDB] WAL ${logName}: not found`)
    }

    console.debug(`[LevelDB] Total keys after WAL: ${this.entries.size}`)
    const playerKey = keyToString(new TextEncoder().encode('~local_player'))
    console.debug(`[LevelDB] ~local_player present: ${this.entries.has(playerKey)}`)

    // Prepare future log file for writes
    this.currentSequence++
    await this.openNewLog()
  }

  /** Get a value by key (returns null if not found) */
  get(key: Uint8Array): Uint8Array | null {
    // Check pending writes first
    const pending = this.pendingWrites.get(keyToString(key))
    if (pending !== undefined) return pending

    return this.entries.get(keyToString(key)) ?? null
  }

  /** Stage a put operation */
  put(key: Uint8Array, value: Uint8Array): void {
    this.pendingWrites.set(keyToString(key), value)
  }

  /** Stage a delete operation */
  delete(key: Uint8Array): void {
    this.pendingWrites.set(keyToString(key), null)
  }

  /** Iterate all keys (including pending writes) */
  *iterate(): Generator<LevelDBEntry> {
    const seen = new Set<string>()

    // Pending writes take priority
    for (const [k, v] of this.pendingWrites) {
      if (v !== null) {
        yield { key: stringToKey(k), value: v }
        seen.add(k)
      }
    }

    for (const [k, v] of this.entries) {
      if (!seen.has(k) && this.pendingWrites.get(k) !== null) {
        yield { key: stringToKey(k), value: v }
      }
    }
  }

  /** Flush all pending writes to the write-ahead log */
  async flush(): Promise<void> {
    if (this.pendingWrites.size === 0) return
    if (!this.logHandle) throw new Error('Log file handle not available')

    const batchData = encodeBatch(this.currentSequence, this.pendingWrites)

    // Read current file size BEFORE opening the writable stream so we know
    // our position within the 32 KB block grid.
    const currentSize = (await this.logHandle.getFile()).size
    const logBytes = encodeLogRecords(batchData, currentSize)

    const writable = await this.logHandle.createWritable({ keepExistingData: true })
    await writable.seek(currentSize)
    await writable.write((logBytes.buffer as ArrayBuffer).slice(logBytes.byteOffset, logBytes.byteOffset + logBytes.byteLength))
    await writable.close()

    // Apply to in-memory store
    for (const [k, v] of this.pendingWrites) {
      if (v !== null) {
        this.entries.set(k, v)
      } else {
        this.entries.delete(k)
      }
    }

    this.currentSequence += BigInt(this.pendingWrites.size)
    this.pendingWrites.clear()
  }

  async close(): Promise<void> {
    await this.flush()
  }

  private async openNewLog(): Promise<void> {
    const currentBuf = await readFileBytes(this.dir, 'CURRENT')
    if (!currentBuf) return

    // Determine next log number from MANIFEST
    const currentText = new TextDecoder().decode(currentBuf).trim()
    const manifestBuf = await readFileBytes(this.dir, currentText)
    if (!manifestBuf) return

    const { lastLogNumber } = parseManifest(manifestBuf)
    const logName = zeroPadded(lastLogNumber, 6) + '.log'

    try {
      this.logHandle = await this.dir.getFileHandle(logName, { create: false })
    } catch {
      // Log file doesn't exist yet—create a new one
      this.logHandle = await this.dir.getFileHandle(logName, { create: true })
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Encode a Uint8Array key as a JSON-safe string for Map keying */
function keyToString(key: Uint8Array): string {
  return JSON.stringify(Array.from(key))
}

function stringToKey(s: string): Uint8Array {
  return new Uint8Array(JSON.parse(s) as number[])
}

/** Encode a simple write batch for the WAL */
function encodeBatch(sequence: bigint, writes: Map<string, Uint8Array | null>): Uint8Array {
  const parts: Uint8Array[] = []
  
  // 8-byte sequence number (little-endian uint64)
  const seqBuf = new ArrayBuffer(8)
  const seqView = new DataView(seqBuf)
  seqView.setUint32(0, Number(sequence & 0xffffffffn), true)
  seqView.setUint32(4, Number(sequence >> 32n), true)
  parts.push(new Uint8Array(seqBuf))

  // 4-byte count
  const cntBuf = new ArrayBuffer(4)
  new DataView(cntBuf).setUint32(0, writes.size, true)
  parts.push(new Uint8Array(cntBuf))

  for (const [k, v] of writes) {
    const key = stringToKey(k)
    if (v !== null) {
      parts.push(new Uint8Array([1])) // kTypeValue
      parts.push(encodeVarInt32(key.byteLength))
      parts.push(key)
      parts.push(encodeVarInt32(v.byteLength))
      parts.push(v)
    } else {
      parts.push(new Uint8Array([0])) // kTypeDeletion
      parts.push(encodeVarInt32(key.byteLength))
      parts.push(key)
    }
  }

  const total = parts.reduce((s, p) => s + p.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) { out.set(p, offset); offset += p.byteLength }
  return out
}

/**
 * Wrap a batch payload in LevelDB log record framing.
 * Handles block boundaries (blocks are 32 KB). Records that would span a
 * block are split into FIRST / MIDDLE / LAST fragments, and blocks with
 * fewer than 7 bytes remaining are zero-padded.
 */
function encodeLogRecords(data: Uint8Array, currentLogSize: number): Uint8Array {
  const BLOCK_SIZE = 32768
  const HEADER_SIZE = 7
  const parts: Uint8Array[] = []

  let dataOffset = 0
  let logOffset = currentLogSize

  while (dataOffset < data.byteLength) {
    const blockOffset = logOffset % BLOCK_SIZE
    const remaining = BLOCK_SIZE - blockOffset

    // Pad tail if fewer than 7 bytes remain in this block
    if (remaining < HEADER_SIZE) {
      parts.push(new Uint8Array(remaining)) // zeroes
      logOffset += remaining
      continue
    }

    const available = remaining - HEADER_SIZE
    const dataLeft = data.byteLength - dataOffset
    const chunkSize = Math.min(available, dataLeft)
    const isFirst = dataOffset === 0
    const isLast = dataOffset + chunkSize === data.byteLength

    // Record type: FULL=1, FIRST=2, MIDDLE=3, LAST=4
    let type: number
    if (isFirst && isLast) type = 1
    else if (isFirst) type = 2
    else if (isLast) type = 4
    else type = 3

    const header = new Uint8Array(HEADER_SIZE)
    const hv = new DataView(header.buffer)
    hv.setUint32(0, 0, true)         // CRC (zero — Bedrock doesn't validate)
    hv.setUint16(4, chunkSize, true) // data length
    header[6] = type

    parts.push(header)
    parts.push(data.slice(dataOffset, dataOffset + chunkSize))

    dataOffset += chunkSize
    logOffset += HEADER_SIZE + chunkSize
  }

  const total = parts.reduce((s, p) => s + p.byteLength, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.byteLength }
  return out
}
