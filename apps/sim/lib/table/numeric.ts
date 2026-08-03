/**
 * Decimal-number parsing shared by the `number` and `percent` column types.
 *
 * Exists because `Number()` accepts far more than a decimal number: `Number()`
 * reads `0x10` as 16, `0b11` as 3, `0o17` as 15, and `Infinity` as infinity. A
 * user typing or pasting `0x10` into a Number cell means the text `0x10`, not
 * sixteen — so parsing it that way silently stores a value they never entered.
 */

/**
 * A decimal number: optional sign, digits with an optional fractional part, and
 * an optional exponent.
 *
 * Exponent notation IS accepted — `1e3` is a normal way for a spreadsheet to
 * export a large number, and reading it as 1000 is what the file means. The
 * non-decimal *bases* are what get refused, because nothing writes a quantity
 * as `0x10` by accident.
 */
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

/**
 * Parses a decimal number, or returns null.
 *
 * Non-finite results are refused too: `1e400` overflows to `Infinity`, which no
 * cell should hold and which `validateCell` would reject on the next write.
 */
export function parseDecimalNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '' || !DECIMAL.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}
