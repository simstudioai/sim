/**
 * Coercions for reading a single value out of an untyped payload — the scalar
 * counterparts to {@link toRecord} and {@link toArray} in `./object`. Each
 * returns the value when it is already of that type and `null` otherwise, so a
 * malformed field reads as absent rather than throwing at the read site.
 */

/** Returns {@link value} when it is a string, `null` otherwise. */
export function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Returns {@link value} when it is a number, `null` otherwise.
 *
 * @remarks Deliberately a `typeof` test only: `NaN` and the infinities are
 * numbers and pass through. Callers that need a finite value should say so.
 */
export function toNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

/** Returns {@link value} when it is a boolean, `null` otherwise. */
export function toBooleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}
