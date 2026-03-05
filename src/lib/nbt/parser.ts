import type { NbtDocument, NbtNode, TagId } from './types'
import { TAG } from './types'
import {
  read as nbtRead,
  write as nbtWrite,
  NBTData,
  TAG as NTAG,
  TAG_TYPE,
  getTagType,
  Int8 as NInt8,
  Int16 as NInt16,
  Int32 as NInt32,
  Float32 as NFloat32,
} from 'nbtify'
import type { Tag, CompoundTag } from 'nbtify'

// --- nbtify -> NbtNode -------------------------------------------------------

function convertNbtify(name: string, value: unknown, keyPrefix: string): NbtNode {
  const tagType = getTagType(value as Tag)

  if (tagType === null) {
    return { key: keyPrefix, type: TAG.End, name, value: null }
  }

  if (tagType === NTAG.COMPOUND) {
    const compound = value as Record<string, unknown>
    const children: NbtNode[] = Object.entries(compound).map(
      ([k, v], i) => convertNbtify(k, v, `${keyPrefix}.${i}-${k}`),
    )
    return { key: keyPrefix, type: TAG.Compound, name, value: null, children }
  }

  if (tagType === NTAG.LIST) {
    const list = value as unknown[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const elemTypeId: number = (list as any)[TAG_TYPE] ?? NTAG.END
    const children: NbtNode[] = list.map((v, i) =>
      convertNbtify(`[${i}]`, v, `${keyPrefix}[${i}]`),
    )
    return { key: keyPrefix, type: TAG.List, name, value: null, children, listType: elemTypeId as TagId }
  }

  if (tagType === NTAG.BYTE)       return { key: keyPrefix, type: TAG.Byte,      name, value: (value as NInt8).valueOf() }
  if (tagType === NTAG.SHORT)      return { key: keyPrefix, type: TAG.Short,     name, value: (value as NInt16).valueOf() }
  if (tagType === NTAG.INT)        return { key: keyPrefix, type: TAG.Int,       name, value: (value as NInt32).valueOf() }
  if (tagType === NTAG.LONG)       return { key: keyPrefix, type: TAG.Long,      name, value: value as bigint }
  if (tagType === NTAG.FLOAT)      return { key: keyPrefix, type: TAG.Float,     name, value: (value as NFloat32).valueOf() }
  if (tagType === NTAG.DOUBLE)     return { key: keyPrefix, type: TAG.Double,    name, value: value as number }
  if (tagType === NTAG.BYTE_ARRAY) return { key: keyPrefix, type: TAG.ByteArray, name, value: value as Int8Array }
  if (tagType === NTAG.STRING)     return { key: keyPrefix, type: TAG.String,    name, value: value as string }
  if (tagType === NTAG.INT_ARRAY)  return { key: keyPrefix, type: TAG.IntArray,  name, value: value as Int32Array }
  if (tagType === NTAG.LONG_ARRAY) return { key: keyPrefix, type: TAG.LongArray, name, value: value as BigInt64Array }

  return { key: keyPrefix, type: TAG.End, name, value: null }
}

// --- NbtNode -> nbtify -------------------------------------------------------

function nodeToNbtify(node: NbtNode): Tag {
  switch (node.type) {
    case TAG.Byte:      return new NInt8(node.value as number)
    case TAG.Short:     return new NInt16(node.value as number)
    case TAG.Int:       return new NInt32(node.value as number)
    case TAG.Long:      return node.value as bigint
    case TAG.Float:     return new NFloat32(node.value as number)
    case TAG.Double:    return node.value as number
    case TAG.ByteArray: return node.value as Int8Array
    case TAG.String:    return node.value as string
    case TAG.IntArray:  return node.value as Int32Array
    case TAG.LongArray: return node.value as BigInt64Array

    case TAG.List: {
      const children = (node.children ?? []).map(nodeToNbtify)
      Object.defineProperty(children, TAG_TYPE, {
        configurable: true, enumerable: false, writable: true,
        value: (node.listType ?? NTAG.END) as number,
      })
      return children as unknown as Tag
    }

    case TAG.Compound: {
      const compound: CompoundTag = {}
      for (const child of node.children ?? []) {
        compound[child.name] = nodeToNbtify(child)
      }
      return compound as unknown as Tag
    }

    default:
      return {} as unknown as Tag
  }
}

// --- Public API --------------------------------------------------------------

/**
 * Parse raw NBT binary data into our editor's document model.
 * Uses nbtify directly in the renderer -- pure ESM, no eval, no IPC needed.
 */
export async function parseNbt(
  data: ArrayBuffer,
  source: NbtDocument['source'],
): Promise<NbtDocument> {
  const bytes = new Uint8Array(data)
  let result: NBTData

  if (source.kind === 'leveldb') {
    // LevelDB values are always little-endian, uncompressed.
    // strict:false allows trailing bytes in some Bedrock key formats.
    try {
      result = await nbtRead(bytes, { endian: 'little', compression: null, strict: false })
    } catch {
      // Some keys store the compound without a root-name tag
      result = await nbtRead(bytes, { endian: 'little', compression: null, rootName: false, strict: false })
    }
  } else {
    // Files: let nbtify auto-detect endian, compression, and rootName
    result = await nbtRead(bytes)
  }

  const root = convertNbtify(result.rootName ?? '', result.data as unknown, 'root')
  return {
    root,
    littleEndian: result.endian !== 'big',
    nbtRootName: result.rootName,
    source,
  }
}

/**
 * Serialise our NbtNode tree back to binary NBT.
 */
export async function serializeNbt(doc: NbtDocument): Promise<Uint8Array> {
  const compound = nodeToNbtify(doc.root) as CompoundTag
  const rootName = doc.nbtRootName !== undefined
    ? doc.nbtRootName
    : (doc.root.name || null)
  const nbtData = new NBTData(compound, {
    rootName,
    endian: doc.littleEndian ? 'little' : 'big',
    compression: null,
    bedrockLevel: false,
  })
  return nbtWrite(nbtData)
}
