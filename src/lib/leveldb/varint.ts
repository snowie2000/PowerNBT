export interface ReadVarInt {
  value: number
  bytesRead: number
}

export interface ReadVarInt64 {
  value: bigint
  bytesRead: number
}

/** Read a LevelDB-style unsigned varint32 from a DataView at the given offset */
export function readVarInt32(view: DataView, offset: number): ReadVarInt {
  let value = 0
  let shift = 0
  let bytesRead = 0
  while (true) {
    const byte = view.getUint8(offset + bytesRead)
    bytesRead++
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) break
    shift += 7
    if (shift >= 32) throw new Error('Varint32 overflow')
  }
  return { value, bytesRead }
}

/** Read a LevelDB-style unsigned varint64 from a DataView at the given offset */
export function readVarInt64(view: DataView, offset: number): ReadVarInt64 {
  let value = 0n
  let shift = 0n
  let bytesRead = 0
  while (true) {
    const byte = view.getUint8(offset + bytesRead)
    bytesRead++
    value |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) break
    shift += 7n
    if (shift >= 64n) throw new Error('Varint64 overflow')
  }
  return { value, bytesRead }
}

/** Encode a 32-bit unsigned integer as a varint into a Uint8Array */
export function encodeVarInt32(value: number): Uint8Array {
  const buf: number[] = []
  while (value > 0x7f) {
    buf.push((value & 0x7f) | 0x80)
    value >>>= 7
  }
  buf.push(value & 0x7f)
  return new Uint8Array(buf)
}
