export interface FileMetaData {
  fileNumber: number
  level: number
  fileSize: number
  smallestKey?: Uint8Array
  largestKey?: Uint8Array
}

export interface VersionEdit {
  logNumber?: number
  nextFileNumber?: number
  lastSequence?: bigint
  newFiles: FileMetaData[]
  deletedFiles: Set<number>
}

// VersionEdit tag bytes
const TAG_COMPARATOR = 1
const TAG_LOG_NUMBER = 2
const TAG_NEXT_FILE = 3
const TAG_LAST_SEQUENCE = 4
const TAG_COMPACT_POINTER = 5
const TAG_DELETED_FILE = 6
const TAG_NEW_FILE = 7

/**
 * Parse the MANIFEST file (which uses the same log format as .log files)
 * to determine the active set of SST files for the database.
 */
export function parseManifest(buf: Uint8Array): { activeFiles: FileMetaData[]; lastLogNumber: number; lastSequence: bigint } {
  const editsRaw = parseManifestEdits(buf)
  const activeFileMap = new Map<number, FileMetaData>()
  let lastLogNumber = 0
  let lastSequence = 0n

  for (const edit of editsRaw) {
    if (edit.logNumber != null) lastLogNumber = edit.logNumber
    if (edit.lastSequence != null && edit.lastSequence > lastSequence) lastSequence = edit.lastSequence
    for (const f of edit.newFiles) {
      activeFileMap.set(f.fileNumber, f)
    }
    for (const fileNum of edit.deletedFiles) {
      activeFileMap.delete(fileNum)
    }
  }

  console.debug(`[LevelDB] Manifest parsed: ${editsRaw.length} edit(s), ${activeFileMap.size} active SST file(s), lastLogNumber=${lastLogNumber}, lastSequence=${lastSequence}`)
  if (activeFileMap.size > 0) {
    const fileList = Array.from(activeFileMap.values()).map(f => `${String(f.fileNumber).padStart(6,'0')}.ldb(L${f.level})`).join(', ')
    console.debug(`[LevelDB] Active files: ${fileList}`)
  }

  return { activeFiles: Array.from(activeFileMap.values()), lastLogNumber, lastSequence }
}

/** Parse MANIFEST binary, extracting each VersionEdit record */
function parseManifestEdits(buf: Uint8Array): VersionEdit[] {
  // MANIFEST uses log record framing
  const LOG_BLOCK_SIZE = 32768
  const HEADER_SIZE = 7

  const edits: VersionEdit[] = []
  const FULL_TYPE = 1
  const FIRST_TYPE = 2
  const MIDDLE_TYPE = 3
  const LAST_TYPE = 4

  let fileOffset = 0

  while (fileOffset < buf.byteLength) {
    let fragments: Uint8Array[] = []
    let blockOffset = 0
    const blockStart = fileOffset

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
        const edit = decodeVersionEdit(fragment)
        if (edit) edits.push(edit)
        fragments = []
      } else if (type === FIRST_TYPE) {
        fragments = [fragment]
      } else if (type === MIDDLE_TYPE) {
        fragments.push(fragment)
      } else if (type === LAST_TYPE) {
        fragments.push(fragment)
        const concat = concatArrays(fragments)
        const edit = decodeVersionEdit(concat)
        if (edit) edits.push(edit)
        fragments = []
      } else {
        break
      }
    }

    fileOffset += LOG_BLOCK_SIZE
  }

  return edits
}

function concatArrays(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) { out.set(a, offset); offset += a.byteLength }
  return out
}

function readVarint(data: Uint8Array, offset: number): { value: number; n: number } {
  let value = 0, shift = 0, n = 0
  while (offset + n < data.byteLength) {
    const byte = data[offset + n++]
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) break
    shift += 7
  }
  return { value, n }
}

function readVarint64(data: Uint8Array, offset: number): { value: bigint; n: number } {
  let value = 0n, shift = 0n, n = 0
  while (offset + n < data.byteLength) {
    const byte = data[offset + n++]
    value |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) break
    shift += 7n
  }
  return { value, n }
}

function readLengthPrefixed(data: Uint8Array, offset: number): { bytes: Uint8Array; n: number } {
  const lenR = readVarint(data, offset)
  const start = offset + lenR.n
  return { bytes: data.subarray(start, start + lenR.value), n: lenR.n + lenR.value }
}

function decodeVersionEdit(data: Uint8Array): VersionEdit | null {
  const edit: VersionEdit = { newFiles: [], deletedFiles: new Set() }
  let offset = 0

  try {
    while (offset < data.byteLength) {
      const tagR = readVarint(data, offset)
      offset += tagR.n
      const tag = tagR.value

      switch (tag) {
        case TAG_COMPARATOR: {
          const r = readLengthPrefixed(data, offset)
          offset += r.n
          break
        }
        case TAG_LOG_NUMBER: {
          const r = readVarint(data, offset)
          edit.logNumber = r.value
          offset += r.n
          break
        }
        case TAG_NEXT_FILE: {
          const r = readVarint(data, offset)
          edit.nextFileNumber = r.value
          offset += r.n
          break
        }
        case TAG_LAST_SEQUENCE: {
          const r = readVarint64(data, offset)
          edit.lastSequence = r.value
          offset += r.n
          break
        }
        case TAG_COMPACT_POINTER: {
          const levelR = readVarint(data, offset); offset += levelR.n
          const keyR = readLengthPrefixed(data, offset); offset += keyR.n
          break
        }
        case TAG_DELETED_FILE: {
          const levelR = readVarint(data, offset); offset += levelR.n
          const fileR = readVarint(data, offset); offset += fileR.n
          edit.deletedFiles.add(fileR.value)
          break
        }
        case TAG_NEW_FILE: {
          const levelR = readVarint(data, offset); offset += levelR.n
          const fileNumR = readVarint(data, offset); offset += fileNumR.n
          const fileSizeR = readVarint(data, offset); offset += fileSizeR.n
          const smallestR = readLengthPrefixed(data, offset); offset += smallestR.n
          const largestR = readLengthPrefixed(data, offset); offset += largestR.n
          edit.newFiles.push({
            level: levelR.value,
            fileNumber: fileNumR.value,
            fileSize: fileSizeR.value,
            smallestKey: smallestR.bytes,
            largestKey: largestR.bytes,
          })
          break
        }
        default:
          // Unknown tag - stop parsing this edit
          return edit
      }
    }
  } catch {
    // partial decode is still useful
  }

  return edit
}
