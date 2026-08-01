/**
 * Decimal-place formatting shared by the `number` and `percent` column types.
 *
 * Kept out of both type files because they own the same `precision` key and
 * must round it identically — a value that renders as `1.5` in a number column
 * and `1.50%` after a conversion would look like the conversion changed it.
 *
 * Deliberately free of registry imports: `column-types/number.ts` imports this,
 * so importing the registry back would close a module-init cycle (the same trap
 * `select-values.ts` documents).
 */

/** Bounds on `precision`, and the value used when a column declares none. */
export const DEFAULT_PRECISION = {
  /**
   * Used only when a caller supplies a value this cannot make sense of. It is
   * NOT stamped onto new columns: neither `number` nor `percent` declares a
   * `defaultMetadata` for `precision`, because absent must keep meaning "render
   * as stored". Stamping `0` would round every new column to whole numbers —
   * a `12.5` cell rendering and CSV-exporting as `13` — and, since `precision`
   * is co-owned, would ride back onto a `number` column through a
   * number → percent → number round-trip and change its rendering too.
   */
  value: 0,
  min: 0,
  /** Beyond this, IEEE-754 doubles have no digits left to show. */
  max: 10,
} as const

/**
 * Rounds `precision` into the supported range, falling back to the default for
 * anything that is not a whole number. Used both to render (`formatWithPrecision`)
 * and to decide whether a supplied value was valid (`validateDefinition`), so
 * the two can never disagree.
 */
export function clampPrecision(precision: number | undefined): number {
  if (typeof precision !== 'number' || !Number.isInteger(precision)) {
    return DEFAULT_PRECISION.value
  }
  return Math.min(DEFAULT_PRECISION.max, Math.max(DEFAULT_PRECISION.min, precision))
}

/**
 * Formats a number to a column's declared decimal places.
 *
 * A column with no `precision` renders the number as-is rather than forcing
 * zero decimals — existing number columns predate this key, and rounding their
 * stored values on sight would look like data loss. Only a column that opts in
 * gets fixed-width output.
 */
export function formatWithPrecision(value: number, precision: number | undefined): string {
  if (!Number.isFinite(value)) return ''
  if (precision === undefined) return String(value)
  return value.toFixed(clampPrecision(precision))
}
