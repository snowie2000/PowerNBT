// NBT Tag type IDs (same as Java & Bedrock)
export const TAG = {
  End: 0,
  Byte: 1,
  Short: 2,
  Int: 3,
  Long: 4,
  Float: 5,
  Double: 6,
  ByteArray: 7,
  String: 8,
  List: 9,
  Compound: 10,
  IntArray: 11,
  LongArray: 12,
} as const

export type TagId = (typeof TAG)[keyof typeof TAG]

export const TAG_NAMES: Record<TagId, string> = {
  [TAG.End]: 'End',
  [TAG.Byte]: 'Byte',
  [TAG.Short]: 'Short',
  [TAG.Int]: 'Int',
  [TAG.Long]: 'Long',
  [TAG.Float]: 'Float',
  [TAG.Double]: 'Double',
  [TAG.ByteArray]: 'Byte Array',
  [TAG.String]: 'String',
  [TAG.List]: 'List',
  [TAG.Compound]: 'Compound',
  [TAG.IntArray]: 'Int Array',
  [TAG.LongArray]: 'Long Array',
}

// A node in our editor's internal tree
export interface NbtNode {
  /** Unique key for Ant Design Tree */
  key: string
  /** Tag type */
  type: TagId
  /** Display name (empty for list elements) */
  name: string
  /** Actual value (null for Compound/List containers) */
  value: NbtValue | null
  /** Child nodes (Compound and List tags) */
  children?: NbtNode[]
  /** For List tags: element type */
  listType?: TagId
}

export type NbtValue =
  | number
  | bigint
  | string
  | Int8Array
  | Int32Array
  | BigInt64Array
  | NbtNode[]

// Root document returned after parsing an NBT file
export interface NbtDocument {
  /** Root compound tag node */
  root: NbtNode
  /** Whether this was a Bedrock little-endian file */
  littleEndian: boolean
  /**
   * NBT root name preserved from parse for round-trip serialization.
   * null  = no root-name tag was present in the binary (e.g. some Bedrock LevelDB values)
   * string = the root name that was read (may be empty string for Java NBT)
   */
  nbtRootName: string | null
  /** Original source: standalone file or LevelDB key */
  source: NbtSource
}

export type NbtSource =
  | { kind: 'file'; path: string; bedrockHeader?: Uint8Array }
  | { kind: 'leveldb'; worldPath: string; key: Uint8Array }
