/**
 * Minecraft Bedrock Edition LevelDB key helpers.
 *
 * Reference: https://minecraft.wiki/w/Bedrock_Edition_level_format
 */

// ── Well-known fixed string keys ────────────────────────────────────────────
export const LOCAL_PLAYER_KEY        = '~local_player'
export const LEVEL_DAT_KEY           = 'leveldata'
export const AUTONOMOUS_ENTITIES     = 'AutonomousEntities'
export const OVERWORLD_DATA          = 'Overworld'
export const NETHER_DATA             = 'Nether'
export const THE_END_DATA            = 'TheEnd'
export const SCOREBOARD_KEY          = 'scoreboard'
export const BIOME_DATA              = 'BiomeData'
export const MOB_EVENTS              = 'mobevents'
export const PORTALS                 = 'portals'
export const SCHEDULER_WT            = 'schedulerWT'
export const LEVEL_CHUNK_META        = 'LevelChunkMetaDataDictionary'
export const GAME_FLAT_LAYERS        = 'game_flatworldlayers'
export const REALMS_STORIES          = 'RealmsStoriesData_'
export const SERVER_FORCED_CORRUPT   = 'DedicatedServerForcedCorruption'

/** Fixed singleton keys that are probed directly on open */
export const SINGLETON_KEYS: string[] = [
  LOCAL_PLAYER_KEY,
  LEVEL_DAT_KEY,
  AUTONOMOUS_ENTITIES,
  OVERWORLD_DATA,
  NETHER_DATA,
  THE_END_DATA,
  SCOREBOARD_KEY,
  BIOME_DATA,
  MOB_EVENTS,
  PORTALS,
  SCHEDULER_WT,
  LEVEL_CHUNK_META,
  GAME_FLAT_LAYERS,
  SERVER_FORCED_CORRUPT,
]

/**
 * All fixed string keys that should always be probed directly in addition to
 * what iterate() returns. Bedrock may write some of these lazily and they may
 * not appear in SST index scans depending on compaction state.
 */
export const WELL_KNOWN_STRING_KEYS: string[] = [
  ...SINGLETON_KEYS,
]

/** String key prefixes (variable suffix after the prefix) */
export const PREFIX_PLAYER          = 'player_'          // + numeric client ID, e.g. player_-12345678
export const PREFIX_MAP             = 'map_'
export const PREFIX_VILLAGE         = 'VILLAGE_'         // + DIMENSION_uuid_SUFFIX
export const PREFIX_ACTOR           = 'actorprefix'      // + binary actor unique ID
export const PREFIX_DIGP            = 'digp'             // + binary chunk coords
export const PREFIX_TICKINGAREA     = 'tickingarea'
export const PREFIX_STRUCTURETEMPL  = 'structuretemplate'
export const PREFIX_DYNAMIC_PROPS   = 'DynamicProperties'
export const PREFIX_SST_SALOG       = 'SST_SALOG'
export const PREFIX_SST_WORD        = 'SST_WORD'
export const PREFIX_REALMS          = 'RealmsStoriesData_'

/**
 * ASCII string prefixes for NBT-containing keys that have a variable suffix.
 * We range-scan just these prefixes instead of iterating all keys.
 * actorprefix and digp are intentionally excluded — they are binary/chunk data.
 */
export const NBT_KEY_PREFIXES: string[] = [
  PREFIX_PLAYER,
  PREFIX_MAP,
  PREFIX_VILLAGE,
  PREFIX_TICKINGAREA,
  PREFIX_STRUCTURETEMPL,
  PREFIX_DYNAMIC_PROPS,
  PREFIX_SST_SALOG,
  PREFIX_SST_WORD,
  PREFIX_REALMS,
]

// ── Dimension IDs ────────────────────────────────────────────────────────────
export const DIM_OVERWORLD = 0
export const DIM_NETHER    = 1
export const DIM_END       = 2

// ── Chunk tag bytes (appended to chunk base key) ─────────────────────────────
// Source: https://minecraft.wiki/w/Bedrock_Edition_level_format#Chunk_key_format
export const TAG_3D_DATA             = 0x2b  // 43  '+'  Data3D (heightmap + biome palettes)
export const TAG_CHUNK_VERSION       = 0x2c  // 44  ','  Version
export const TAG_DATA_2D             = 0x2d  // 45  '-'  Data2D (heightmap + 2D biomes)
export const TAG_DATA_2D_LEGACY      = 0x2e  // 46  '.'  Data2DLegacy
export const TAG_SUBCHUNK_PREFIX     = 0x2f  // 47  '/'  SubChunkPrefix  (+ 1 byte subchunk index)
export const TAG_LEGACY_TERRAIN      = 0x30  // 48  '0'  LegacyTerrain
export const TAG_BLOCK_ENTITY        = 0x31  // 49  '1'  BlockEntity (little-endian NBT list)
export const TAG_ENTITY              = 0x32  // 50  '2'  Entity (little-endian NBT list)
export const TAG_PENDING_TICKS       = 0x33  // 51  '3'  PendingTicks
export const TAG_BLOCK_EXTRA_DATA    = 0x34  // 52  '4'  LegacyBlockExtraData
export const TAG_BIOME_STATE         = 0x35  // 53  '5'  BiomeState
export const TAG_FINALIZATION        = 0x36  // 54  '6'  FinalizedState
export const TAG_CONVERSION_DATA     = 0x37  // 55  '7'  ConversionData
export const TAG_BORDER_BLOCKS       = 0x38  // 56  '8'  BorderBlocks (Education Edition)
export const TAG_HARDCODED_SPAWNERS  = 0x39  // 57  '9'  HardcodedSpawners
export const TAG_RANDOM_TICKS        = 0x3a  // 58  ':'  RandomTicks
export const TAG_CHECKSUMS           = 0x3b  // 59  ';'  Checksums (deprecated ≥1.18)
export const TAG_METADATA_HASH       = 0x3d  // 61  '='  MetaDataHash
export const TAG_GENERATED_PRE_CB    = 0x3e  // 62  '>'  GeneratedPreCavesAndCliffsBlending
export const TAG_BLENDING_BIOME_HGT  = 0x3f  // 63  '?'  BlendingBiomeHeight
export const TAG_BLENDING_DATA       = 0x40  // 64  '@'  BlendingData
export const TAG_ACTOR_DIGEST_VER    = 0x41  // 65  'A'  ActorDigestVersion
export const TAG_LEGACY_VERSION      = 0x76  // 118 'v'  LegacyVersion (moved to 0x2C in 1.16.100)
export const TAG_AABB_VOLUMES        = 0x77  // 119 'w'  AABBVolumes

// Human-readable names for each tag byte
const CHUNK_TAG_NAMES: Record<number, string> = {
  [TAG_3D_DATA]:            'Data3D',
  [TAG_CHUNK_VERSION]:      'Version',
  [TAG_DATA_2D]:            'Data2D',
  [TAG_DATA_2D_LEGACY]:     'Data2DLegacy',
  [TAG_SUBCHUNK_PREFIX]:    'SubChunkPrefix',
  [TAG_LEGACY_TERRAIN]:     'LegacyTerrain',
  [TAG_BLOCK_ENTITY]:       'BlockEntity',
  [TAG_ENTITY]:             'Entity',
  [TAG_PENDING_TICKS]:      'PendingTicks',
  [TAG_BLOCK_EXTRA_DATA]:   'BlockExtraData',
  [TAG_BIOME_STATE]:        'BiomeState',
  [TAG_FINALIZATION]:       'FinalizedState',
  [TAG_CONVERSION_DATA]:    'ConversionData',
  [TAG_BORDER_BLOCKS]:      'BorderBlocks',
  [TAG_HARDCODED_SPAWNERS]: 'HardcodedSpawners',
  [TAG_RANDOM_TICKS]:       'RandomTicks',
  [TAG_CHECKSUMS]:          'Checksums',
  [TAG_METADATA_HASH]:      'MetaDataHash',
  [TAG_GENERATED_PRE_CB]:   'GenPreCavesBlending',
  [TAG_BLENDING_BIOME_HGT]: 'BlendingBiomeHeight',
  [TAG_BLENDING_DATA]:      'BlendingData',
  [TAG_ACTOR_DIGEST_VER]:   'ActorDigestVersion',
  [TAG_LEGACY_VERSION]:     'LegacyVersion',
  [TAG_AABB_VOLUMES]:       'AABBVolumes',
}

// ── Key builders ─────────────────────────────────────────────────────────────

/** Build the 8-byte (overworld) or 12-byte (other dims) base chunk key */
export function chunkKey(cx: number, cz: number, dimension?: number): Uint8Array {
  const hasDim = dimension != null && dimension !== DIM_OVERWORLD
  const buf = new ArrayBuffer(hasDim ? 12 : 8)
  const view = new DataView(buf)
  view.setInt32(0, cx, true)
  view.setInt32(4, cz, true)
  if (hasDim) view.setInt32(8, dimension!, true)
  return new Uint8Array(buf)
}

/** Key for a specific sub-chunk data record */
export function subChunkKey(cx: number, cz: number, subIndex: number, dimension?: number): Uint8Array {
  const base = chunkKey(cx, cz, dimension)
  const key = new Uint8Array(base.byteLength + 2)
  key.set(base)
  key[base.byteLength]     = TAG_SUBCHUNK_PREFIX
  key[base.byteLength + 1] = subIndex & 0xff
  return key
}

/** Key for a chunk-level tag (entity, block entity, biome, version, etc.) */
export function chunkTagKey(cx: number, cz: number, tag: number, dimension?: number): Uint8Array {
  const base = chunkKey(cx, cz, dimension)
  const key = new Uint8Array(base.byteLength + 1)
  key.set(base)
  key[base.byteLength] = tag & 0xff
  return key
}

/**
 * Remote player data key.
 * Format: "player_" + numeric client ID, e.g. "player_-12345678"
 * (The client ID is stored in the player's clientid.txt file.)
 * Servers/Realms may also use UUIDs: "player_server_<UUID>"
 */
export function playerKey(clientId: string): Uint8Array {
  return stringKey(`player_${clientId}`)
}

/** Convert a plain string to a Uint8Array key */
export function stringKey(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

// ── describeKey ──────────────────────────────────────────────────────────────

/**
 * Return a human-readable label for any LevelDB key.
 * Follows the key format spec at:
 * https://minecraft.wiki/w/Bedrock_Edition_level_format
 */
export function describeKey(key: Uint8Array): string {
  // 1. Try to decode as a printable ASCII / UTF-8 string
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(key)
    if (/^[\x20-\x7E~]+$/.test(text)) {
      // Annotate known string prefixes for clarity
      if (text === LOCAL_PLAYER_KEY)  return text
      if (text.startsWith(PREFIX_PLAYER))       return text   // player_-12345678 or player_server_...
      if (text.startsWith(PREFIX_MAP))          return text
      if (text.startsWith(PREFIX_VILLAGE))      return text
      if (text.startsWith(PREFIX_TICKINGAREA))  return text
      if (text.startsWith(PREFIX_STRUCTURETEMPL)) return text
      if (text.startsWith(PREFIX_DYNAMIC_PROPS))  return text
      if (text.startsWith(PREFIX_SST_SALOG))    return text
      if (text.startsWith(PREFIX_SST_WORD))     return text
      if (text.startsWith(PREFIX_REALMS))       return text
      return text
    }
  } catch {
    // not valid UTF-8, fall through
  }

  // 2. Binary prefix keys (start with known text + binary suffix)
  if (key.byteLength >= 11 && startsWithText(key, PREFIX_ACTOR)) {
    return `actorprefix <${key.byteLength - 11}B id>`
  }
  if (key.byteLength >= 4 && startsWithText(key, PREFIX_DIGP)) {
    const suffix = key.byteLength - 4
    return suffix === 8 || suffix === 12
      ? `digp (chunk key ${suffix}B)`
      : `digp <${suffix}B>`
  }

  // 3. Chunk keys: base 8 or 12 bytes + optional tag + optional subchunk index
  //    Valid key lengths: 9, 10, 13, 14 bytes per wiki
  //    (base 8 + 1 tag [+ 1 subchunk] or base 12 + 1 tag [+ 1 subchunk])
  const len = key.byteLength
  if (len === 9 || len === 10 || len === 13 || len === 14) {
    const view  = new DataView(key.buffer, key.byteOffset, key.byteLength)
    const cx    = view.getInt32(0, true)
    const cz    = view.getInt32(4, true)
    const hasDim = len === 13 || len === 14
    const dimStr = hasDim ? ` dim=${view.getInt32(8, true)}` : ' [OW]'
    const tagOffset = hasDim ? 12 : 8
    const tag   = key[tagOffset]
    const tagName = CHUNK_TAG_NAMES[tag] ?? `0x${tag.toString(16).toUpperCase()}`

    if (tag === TAG_SUBCHUNK_PREFIX && (len === 10 || len === 14)) {
      const sub = key[tagOffset + 1]
      return `SubChunk (${cx},${cz}) y=${sub}${dimStr}`
    }
    return `Chunk (${cx},${cz}) ${tagName}${dimStr}`
  }

  return `<binary ${key.byteLength}B>`
}

/** Check whether key starts with the bytes of a plain ASCII string prefix */
function startsWithText(key: Uint8Array, prefix: string): boolean {
  if (key.byteLength < prefix.length) return false
  for (let i = 0; i < prefix.length; i++) {
    if (key[i] !== prefix.charCodeAt(i)) return false
  }
  return true
}

