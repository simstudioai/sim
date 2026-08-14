import { ZodError } from 'zod'

/**
 * Rejects a query parameter that is present but carries no value —
 * `?limit=`, `?limit=%20`, `?search=`.
 *
 * A blank value is not the same request as an omitted parameter, but nothing in
 * a schema makes that true on its own. `z.coerce.number()` reads `''` as `0`
 * (`Number('') === 0`), so `?limit=` on the lists that clamp became `LIMIT 1` —
 * one row where the omitted param gives a hundred — and `?minCost=` became a
 * live `cost >= 0` filter. Each is a different result set from the one the
 * caller believed they asked for, and none of them is reported.
 *
 * It runs on the *raw* query, before schema validation, because that is the only
 * place the blank still exists: coercion has already turned it into `0`, `false`,
 * or a default by the time a parsed value is available. Applying it at the
 * surface rather than per schema is what makes a parameter added later inherit
 * the rule.
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

/**
 * Rejects a query parameter sent more than once — `?workspaceId=X&workspaceId=X`.
 *
 * A repeated parameter reaches the schema as an array, and no v2 query parameter
 * is declared as one: every list this surface accepts is a single
 * comma-separated string. The array therefore fails the declared type, and the
 * caller is told whatever that type's own message says — `workspaceId` answers
 * "Workspace ID is required" for a request that sent it twice, which points at
 * the wrong problem. Naming the duplication is the whole fix, and like the blank
 * scan above it belongs at the boundary: by the time a schema sees the value,
 * the array is indistinguishable from any other wrong type.
 */
export function duplicateQueryValueValidationError(
  rawQuery: Record<string, string | string[]>
): ZodError | null {
  for (const [name, value] of Object.entries(rawQuery)) {
    if (!Array.isArray(value)) continue
    return new ZodError([
      {
        code: 'custom',
        path: [name],
        message: `${name} was sent ${value.length} times; send it at most once`,
        input: undefined,
      },
    ])
  }
  return null
}
