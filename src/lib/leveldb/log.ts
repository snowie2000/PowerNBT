import { readVarInt32 } from './varint'

/** A LevelDB log record: a sequence of physical block records that together form one logical record */

const LOG_BLOCK_SIZE = 32768
const HEADER_SIZE = 7 // crc(4) + length(2) + type(1)

const FULL_TYPE = 1
const FIRST_TYPE = 2
const MIDDLE_TYPE = 3
const LAST_TYPE = 4

export interface WriteBatchEntry {
  type: 'put' | 'delete'
  key: Uint8Array
  value: Uint8Array | null
}

export interface WriteBatch {
  sequence: bigint
  entries: WriteBatchEntry[]
}

/**
 * Parse a LevelDB write-ahead log (.log) file and return all write batches.
 * These represent writes that may not yet be compacted into SST files.
 */
export function parseLogFile(buf: Uint8Array): WriteBatch[] {
  const batches: WriteBatch[] = []
  let fileOffset = 0

  while (fileOffset < buf.byteLength) {
    const blockStart = fileOffset
    let fragments: Uint8Array[] = []
    let inRecord = false

    // Process one block at a time
    let blockOffset = 0
    while (blockOffset + HEADER_SIZE <= LOG_BLOCK_SIZE && fileOffset + blockOffset + HEADER_SIZE <= buf.byteLength) {
      const recStart = blockStart + blockOffset
      if (recStart + HEADER_SIZE > buf.byteLength) break

      const view = new DataView(buf.buffer, buf.byteOffset + recStart, HEADER_SIZE)
      const length = view.getUint16(4, true)
      const type = view.getUint8(6)

      blockOffset += HEADER_SIZE
      const dataStart = recStart + HEADER_SIZE

      if (dataStart + length > buf.byteLength) break

      const fragment = buf.subarray(dataStart, dataStart + length)
      blockOffset += length

      if (type === FULL_TYPE) {
        fragments = [fragment]
        const batch = parseWriteBatch(concatArrays(fragments))
        if (batch) batches.push(batch)
        fragments = []
        inRecord = false
      } else if (type === FIRST_TYPE) {
        fragments = [fragment]
        inRecord = true
      } else if (type === MIDDLE_TYPE && inRecord) {
        fragments.push(fragment)
      } else if (type === LAST_TYPE && inRecord) {
        fragments.push(fragment)
        const batch = parseWriteBatch(concatArrays(fragments))
        if (batch) batches.push(batch)
        fragments = []
        inRecord = false
      } else {
        // Unknown or corrupt record type, skip rest of block
        break
      }
    }

    // Advance to next block
    fileOffset += LOG_BLOCK_SIZE
  }

  return batches
}

function concatArrays(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.byteLength
  }
  return out
}

function parseWriteBatch(data: Uint8Array): WriteBatch | null {
  if (data.byteLength < 12) return null

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const seqLo = view.getUint32(0, true)
  const seqHi = view.getUint32(4, true)
  const sequence = BigInt(seqLo) | (BigInt(seqHi) << 32n)
  const count = view.getUint32(8, true)

  const entries: WriteBatchEntry[] = []
  let offset = 12

  for (let i = 0; i < count && offset < data.byteLength; i++) {
    const entryType = data[offset++]

    // Read key
    const keyLen = readVarInt32(view, offset)
    offset += keyLen.bytesRead
    const key = data.subarray(offset, offset + keyLen.value)
    offset += keyLen.value

    if (entryType === 1) {
      // kTypeValue
      const valLen = readVarInt32(view, offset)
      offset += valLen.bytesRead
      const value = data.subarray(offset, offset + valLen.value)
      offset += valLen.value
      entries.push({ type: 'put', key, value })
    } else if (entryType === 0) {
      // kTypeDeletion
      entries.push({ type: 'delete', key, value: null })
    }
  }

  return { sequence, entries }
}
