import { ZodError } from 'zod'

/**
 * Rejects a query parameter that is present but carries no value —
 * `?limit=`, `?limit=%20`, `?search=`.
 *
 * A blank value is not the same request as an omitted parameter, but nothing in
 * a schema makes that true on its own. `z.coerce.number()` reads `''` as `0`
 * (`Number('') === 0`), so `?limit=` on the three lists that clamp instead of
 * rejecting became `LIMIT 1` — one row where the omitted param gives a hundred.
 * `z.coerce.number().optional()` on the `/logs` cost and duration bounds turned
 * `?minCost=` into a live `cost >= 0` filter. A plain `z.string()` filter kept
 * the `''` and compared against it. Each of those is a different result set from
 * the one the caller believed they asked for, and none of them is reported.
 *
 * The v2 surface already answers a blank the same way wherever a schema happens
 * to notice — `search` is `.min(1, 'search cannot be empty')` and `cursor` is
 * `.min(1, 'cursor must be a non-empty token')`, both documented as "omit the
 * parameter instead". This applies that published rule to every parameter
 * rather than to the ones whose schema was written strictly enough, so a
 * parameter added later inherits it.
 *
 * It runs on the *raw* query, before schema validation, because that is the only
 * place the blank still exists: coercion has already turned it into `0`, `false`,
 * or a default by the time a parsed value is available.
 *
 * This is a boundary rule rather than a shared string primitive for the same
 * reason as the NUL-byte scan next door: a primitive only protects the params
 * somebody remembered to build on it.
 */
export function blankQueryValueValidationError(
  rawQuery: Record<string, string | string[]>
): ZodError | null {
  for (const [name, value] of Object.entries(rawQuery)) {
    const values = Array.isArray(value) ? value : [value]
    if (!values.some((entry) => entry.trim().length === 0)) continue
    return new ZodError([
      {
        code: 'custom',
        path: [name],
        message: `${name} cannot be empty; omit the parameter instead`,
        input: undefined,
      },
    ])
  }
  return null
}
