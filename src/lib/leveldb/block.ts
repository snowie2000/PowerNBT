import pako from 'pako'
import { readVarInt32 } from './varint'

export const BLOCK_SIZE = 32 * 1024 // default block size

// Compression type bytes used in LevelDB
export const COMPRESSION_NONE = 0x00
export const COMPRESSION_SNAPPY = 0x01
export const COMPRESSION_ZLIB = 0x02
export const COMPRESSION_ZLIB_RAW = 0x04 // Minecraft Bedrock mcpe-leveldb

export interface KVEntry {
  key: Uint8Array
  value: Uint8Array
}

/**
 * Decompress a block's payload according to its compression type byte.
 * Bedrock LevelDB uses ZLIB_RAW (0x04) or ZLIB (0x02).
 * Standard LevelDB uses SNAPPY (0x01) – not supported in browser without WASM; 
 * we throw a helpful error if we encounter it.
 */
export function decompressBlock(
  data: Uint8Array,
  compressionType: number,
): Uint8Array {
  switch (compressionType) {
    case COMPRESSION_NONE:
      return data
    case COMPRESSION_ZLIB:
      return pako.inflate(data)
    case COMPRESSION_ZLIB_RAW:
      return pako.inflateRaw(data)
    case COMPRESSION_SNAPPY:
      throw new Error(
        'Snappy compression is not supported in the browser. ' +
          'This world appears to use standard (Java-like) LevelDB compression.',
      )
    default:
      throw new Error(`Unknown block compression type: 0x${compressionType.toString(16)}`)
  }
}

/**
 * Parse a decompressed LevelDB data block payload into key-value entries.
 *
 * Block layout (after decompression):
 *   [entry]* [restart_offset: uint32]* num_restarts: uint32
 *
 * Each entry: shared_len (varint) | unshared_len (varint) | value_len (varint) | unshared_key | value
 */
export function parseBlock(payload: Uint8Array): KVEntry[] {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)

  // last 4 bytes = num_restarts
  const numRestarts = view.getUint32(payload.byteLength - 4, true)
  const restartsStart = payload.byteLength - 4 - numRestarts * 4
  // restart offsets precede that
  const entries: KVEntry[] = []

  let offset = 0
  let lastKey = new Uint8Array(0)

  while (offset < restartsStart) {
    const sr = readVarInt32(view, offset)
    offset += sr.bytesRead
    const ur = readVarInt32(view, offset)
    offset += ur.bytesRead
    const vr = readVarInt32(view, offset)
    offset += vr.bytesRead

    const sharedLen = sr.value
    const unsharedLen = ur.value
    const valueLen = vr.value

    const key = new Uint8Array(sharedLen + unsharedLen)
    key.set(lastKey.subarray(0, sharedLen), 0)
    key.set(payload.subarray(offset, offset + unsharedLen), sharedLen)
    offset += unsharedLen

    const value = payload.subarray(offset, offset + valueLen)
    offset += valueLen

    lastKey = key
    // Strip the 8-byte internal key suffix (sequence + type) to get user key
    const userKey = key.subarray(0, Math.max(0, key.byteLength - 8))
    entries.push({ key: userKey, value })
  }

  return entries
}
