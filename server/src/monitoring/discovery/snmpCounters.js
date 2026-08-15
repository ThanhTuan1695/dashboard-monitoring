/**
 * net-snmp returns Counter64 varbinds as raw `Buffer` objects (big-endian) —
 * JavaScript numbers can't natively hold 64-bit integers, and the library
 * deliberately doesn't try. Converts via BigInt, then back to a plain Number:
 * safe in practice, since a byte counter would need to sustain multiple GB/s
 * continuously for years to exceed Number.MAX_SAFE_INTEGER.
 */
function counter64ToNumber(value) {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) {
    let big = 0n;
    for (const byte of value) big = (big << 8n) | BigInt(byte);
    return Number(big);
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

module.exports = { counter64ToNumber };
