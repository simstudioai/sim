import { z } from 'zod'

export const unknownRecordSchema = z.record(z.string(), z.unknown())

export function flattenFieldErrors<TFields extends string>(
  error: z.ZodError
): Partial<Record<TFields, string>> {
  const result: Partial<Record<TFields, string>> = {}
  for (const issue of error.issues) {
    const field = issue.path[0]
    if (typeof field !== 'string') continue
    if (result[field as TFields] === undefined) {
      result[field as TFields] = issue.message
    }
  }
  return result
}

export const noInputSchema = z.object({}).strict()
export type NoInput = z.output<typeof noInputSchema>

export const jobIdParamsSchema = z.object({
  jobId: z.string().min(1),
})

/**
 * Non-empty string identifier (used for workspace, workflow, user, table, etc.).
 * Prefer this over inline `z.string().min(1)` so error wording stays consistent
 * and refactors can centralize ID validation in one place.
 */
export const nonEmptyIdSchema = z.string().min(1)

/**
 * Non-empty `workspaceId` field. Same constraint as `nonEmptyIdSchema` with a
 * stable, human-readable message. Use to deduplicate the
 * `z.string().min(1, 'Workspace ID is required')` pattern across contracts.
 */
export const workspaceIdSchema = z.string().min(1, 'Workspace ID is required')

/**
 * Non-empty `workflowId` field. Same constraint as `nonEmptyIdSchema` with a
 * stable, human-readable message.
 */
export const workflowIdSchema = z.string().min(1, 'Workflow ID is required')

/**
 * Boolean query-string primitive that correctly handles the literal strings
 * `"true"` / `"false"` (case-insensitive) in addition to real booleans.
 *
 * Do NOT use `z.coerce.boolean()` for query parameters: it coerces any
 * non-empty string to `true`, so `?flag=false` resolves to `true`. This
 * primitive treats `"false"` / `"0"` / `""` as `false` and `"true"` / `"1"`
 * as `true`, mirroring how query strings are commonly serialized by
 * frontends and CLIs.
 *
 * Real boolean inputs (e.g. when `requestJson` serializes a JS `true`) pass
 * through unchanged. Anything else fails validation with a clear message.
 *
 * Use `.optional()` / `.default(...)` at the call site, not here, so each
 * query field controls its own omission/default semantics.
 */
export const booleanQueryFlagSchema = z.preprocess(
  (value) => {
    if (typeof value === 'boolean') return value
    if (typeof value !== 'string') return value
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0' || normalized === '') return false
    return value
  },
  z.boolean({ error: 'must be a boolean (true/false)' })
)
