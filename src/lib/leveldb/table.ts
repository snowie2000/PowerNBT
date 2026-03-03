import { readVarInt64 } from './varint'
import { decompressBlock, parseBlock, type KVEntry } from './block'

// LevelDB table file magic number
const TABLE_MAGIC_LO = 0x8b80fb57
const TABLE_MAGIC_HI = 0xdb477524

// Footer is always 48 bytes at end of file
const FOOTER_SIZE = 48

interface BlockHandle {
  offset: bigint
  size: bigint
}

function readBlockHandle(view: DataView, offset: number): { handle: BlockHandle; bytesRead: number } {
  const offsetR = readVarInt64(view, offset)
  const sizeR = readVarInt64(view, offset + offsetR.bytesRead)
  return {
    handle: { offset: offsetR.value, size: sizeR.value },
    bytesRead: offsetR.bytesRead + sizeR.bytesRead,
  }
}

function readRawBlock(buf: Uint8Array, handle: BlockHandle): { payload: Uint8Array; compressionType: number } {
  const start = Number(handle.offset)
  const size = Number(handle.size)
  // Block trailer: compression_type (1 byte) + crc32 (4 bytes)
  const compressionType = buf[start + size]
  const payload = buf.subarray(start, start + size)
  return { payload, compressionType }
}

/**
 * Parse a LevelDB SSTable (.ldb) file and return all user key-value entries.
 * Validates the footer magic to confirm the file is a valid LevelDB table.
 */
export function parseTable(buf: Uint8Array): KVEntry[] {
  if (buf.byteLength < FOOTER_SIZE) {
    throw new Error('Table file is too small to contain a valid footer')
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  // Verify magic (last 8 bytes of footer)
  const footerStart = buf.byteLength - FOOTER_SIZE
  const magicLo = view.getUint32(buf.byteLength - 8, true)
  const magicHi = view.getUint32(buf.byteLength - 4, true)
  if (magicLo !== TABLE_MAGIC_LO || magicHi !== TABLE_MAGIC_HI) {
    throw new Error('Invalid LevelDB table magic number')
  }

  // Footer layout (bytes 0-47):
  //   [metaindex_handle: varint offset + varint size]
  //   [index_handle:     varint offset + varint size]
  //   [padding zeros until byte 39]
  //   [magic: 8 bytes]
  // We must skip past metaindex_handle to reach index_handle.
  const { bytesRead: metaBytesRead } = readBlockHandle(view, footerStart)
  const { handle: indexHandle } = readBlockHandle(view, footerStart + metaBytesRead)

  if (
    indexHandle.size === 0n ||
    Number(indexHandle.offset) + Number(indexHandle.size) + 5 > buf.byteLength
  ) {
    throw new Error('Index block handle in footer points outside file bounds')
  }

  // Read and decompress index block
  const { payload: indexPayload, compressionType: indexCompType } = readRawBlock(buf, indexHandle)
  const indexData = decompressBlock(indexPayload, indexCompType)
  const indexEntries = parseBlock(indexData)

  // Each index entry value is a BlockHandle pointing to a data block
  const entries: KVEntry[] = []
  for (const idxEntry of indexEntries) {
    if (idxEntry.value.byteLength === 0) continue
    try {
      const valueView = new DataView(
        idxEntry.value.buffer,
        idxEntry.value.byteOffset,
        idxEntry.value.byteLength,
      )
      const { handle: dataHandle } = readBlockHandle(valueView, 0)
      const { payload, compressionType } = readRawBlock(buf, dataHandle)
      const data = decompressBlock(payload, compressionType)
      entries.push(...parseBlock(data))
    } catch {
      // skip malformed entries
    }
  }

  return entries
}
