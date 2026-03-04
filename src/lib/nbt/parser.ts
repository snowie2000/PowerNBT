import type { NbtDocument, NbtNode, TagId } from './types'
import { TAG } from './types'

// prismarine-nbt internal value types
interface PNbtValue {
  type: string
  name?: string
  value: unknown
}

/** Convert a prismarine-nbt parsed tree into our NbtNode tree */
function convertValue(
  name: string,
  type: string,
  value: unknown,
  keyPrefix: string,
): NbtNode {
  const tagId = typeNameToId(type)
  const key = keyPrefix

  if (type === 'compound') {
    const compound = value as Record<string, PNbtValue>
    const children: NbtNode[] = Object.entries(compound).map(
      ([k, v], i) => convertValue(k, v.type, v.value, `${key}.${i}-${k}`),
    )
    return { key, type: tagId, name, value: null, children }
  }

  if (type === 'list') {
    const list = value as { type: string; value: unknown[] }
    const listType = typeNameToId(list.type)
    const children: NbtNode[] = list.value.map((v, i) =>
      convertValue(`[${i}]`, list.type, v, `${key}[${i}]`),
    )
    return { key, type: tagId, name, value: null, children, listType }
  }

  // Primitives
  if (type === 'byte' || type === 'short' || type === 'int' || type === 'float' || type === 'double') {
    return { key, type: tagId, name, value: value as number }
  }

  if (type === 'long') {
    // prismarine-nbt returns long as [high, low] array
    const parts = value as [number, number]
    const big = (BigInt(parts[0]) << 32n) | BigInt(parts[1] >>> 0)
    return { key, type: tagId, name, value: big }
  }

  if (type === 'string') {
    return { key, type: tagId, name, value: value as string }
  }

  if (type === 'byteArray') {
    return { key, type: tagId, name, value: new Int8Array(value as number[]) }
  }

  if (type === 'intArray') {
    return { key, type: tagId, name, value: new Int32Array(value as number[]) }
  }

  if (type === 'longArray') {
    const arr = (value as [number, number][]).map(
      ([hi, lo]) => (BigInt(hi) << 32n) | BigInt(lo >>> 0),
    )
    return { key, type: tagId, name, value: new BigInt64Array(arr) }
  }

  return { key, type: tagId, name, value: null }
}

function typeNameToId(typeName: string): TagId {
  const map: Record<string, TagId> = {
    end: TAG.End,
    byte: TAG.Byte,
    short: TAG.Short,
    int: TAG.Int,
    long: TAG.Long,
    float: TAG.Float,
    double: TAG.Double,
    byteArray: TAG.ByteArray,
    string: TAG.String,
    list: TAG.List,
    compound: TAG.Compound,
    intArray: TAG.IntArray,
    longArray: TAG.LongArray,
  }
  return map[typeName] ?? TAG.End
}

/**
 * Parse raw NBT binary data into our editor's document model.
 * Parsing is delegated to the main process (prismarine-nbt uses eval and
 * cannot run inside the Vite-bundled renderer).
 */
export async function parseNbt(
  data: ArrayBuffer,
  source: NbtDocument['source'],
): Promise<NbtDocument> {
  // Hint: leveldb values are always little-endian; files try both
  const littleEndianHint: boolean | null = source.kind === 'leveldb' ? true : null
  const bytes = Array.from(new Uint8Array(data))
  const { pnbt, littleEndian } = await window.electronAPI.nbt.parse(bytes, littleEndianHint)
  const parsed = pnbt as { name?: string; type: string; value: unknown }
  const root = convertValue(parsed.name ?? '', parsed.type, parsed.value, 'root')
  return { root, littleEndian, source }
}

/**
 * Serialise our NbtNode tree back to binary NBT.
 * Serialization is delegated to the main process.
 */
export async function serializeNbt(doc: NbtDocument): Promise<Uint8Array> {
  const pnbt = nodeToP(doc.root)
  const bytes = await window.electronAPI.nbt.serialize(pnbt, doc.littleEndian)
  return new Uint8Array(bytes)
}

function nodeToP(node: NbtNode): PNbtValue {
  const type = idToTypeName(node.type)

  if (node.type === TAG.Compound) {
    const compound: Record<string, PNbtValue> = {}
    for (const child of node.children ?? []) {
      compound[child.name] = nodeToP(child)
    }
    return { type, name: node.name, value: compound }
  }

  if (node.type === TAG.List) {
    const children = node.children ?? []
    const elemType = children.length > 0 ? idToTypeName(node.listType ?? TAG.End) : 'end'
    return {
      type,
      name: node.name,
      value: { type: elemType, value: children.map((c) => nodeToP(c).value) },
    }
  }

  if (node.type === TAG.Long) {
    const big = node.value as bigint
    // prismarine-nbt writes both halves with writeInt32LE → must be signed int32
    const hi = Number(BigInt.asIntN(32, big >> 32n))
    const lo = Number(BigInt.asIntN(32, big & 0xFFFFFFFFn))
    return { type, name: node.name, value: [hi, lo] }
  }

  if (node.type === TAG.LongArray) {
    const arr = node.value as BigInt64Array
    const pairs = Array.from(arr).map((b) => [
      Number(BigInt.asIntN(32, b >> 32n)),
      Number(BigInt.asIntN(32, b & 0xFFFFFFFFn)),
    ])
    return { type, name: node.name, value: pairs }
  }

  if (node.type === TAG.ByteArray) {
    return { type, name: node.name, value: Array.from(node.value as Int8Array) }
  }

  if (node.type === TAG.IntArray) {
    return { type, name: node.name, value: Array.from(node.value as Int32Array) }
  }

  return { type, name: node.name, value: node.value }
}

function idToTypeName(id: TagId): string {
  const map: Record<number, string> = {
    [TAG.End]: 'end',
    [TAG.Byte]: 'byte',
    [TAG.Short]: 'short',
    [TAG.Int]: 'int',
    [TAG.Long]: 'long',
    [TAG.Float]: 'float',
    [TAG.Double]: 'double',
    [TAG.ByteArray]: 'byteArray',
    [TAG.String]: 'string',
    [TAG.List]: 'list',
    [TAG.Compound]: 'compound',
    [TAG.IntArray]: 'intArray',
    [TAG.LongArray]: 'longArray',
  }
  return map[id] ?? 'end'
}
