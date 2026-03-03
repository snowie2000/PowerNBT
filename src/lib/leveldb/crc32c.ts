/**
 * CRC32C (Castagnoli) implementation used by LevelDB for WAL and SST block checksums.
 *
 * LevelDB "masks" the CRC to avoid confusion with 0xFFFFFFFF padding bytes:
 *   maskedCrc = ((crc >>> 15) | (crc << 17)) + 0xa282ead8
 */

// Precomputed 256-entry table for CRC32C (reflected polynomial 0x82F63B78)
const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 1 ? 0x82F63B78 ^ (c >>> 1) : c >>> 1
    t[i] = c
  }
  return t
})()

/**
 * Compute CRC32C over `data`, optionally continuing from a previous `crc` value.
 * Returns an unsigned 32-bit integer.
 */
export function crc32c(data: Uint8Array, initial = 0xFFFFFFFF): number {
  let crc = initial
  for (let i = 0; i < data.length; i++) {
    crc = TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

/**
 * Apply the LevelDB CRC mask so stored values are never 0xFFFFFFFF or 0.
 * Stored = Mask(CRC32C(data)).
 */
export function maskCrc(crc: number): number {
  return ((((crc >>> 15) | (crc << 17)) >>> 0) + 0xa282ead8) >>> 0
}
