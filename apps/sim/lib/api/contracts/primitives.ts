import { z } from 'zod'
import { PII_LANGUAGE_CODES } from '@/lib/guardrails/pii-entities'

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
 * Non-empty `organizationId` field. Same constraint as `nonEmptyIdSchema` with a
 * stable, human-readable message.
 */
export const organizationIdSchema = z.string().min(1, 'Organization ID is required')

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
/**
 * Canonical boundary schema for `UserFile` (`apps/sim/executor/types.ts`) — the
 * shape produced by the executor and persisted in `workflowExecutionLogs.files`,
 * forwarded through tool inputs, and rendered in the logs UI. `.passthrough()`
 * tolerates legacy/extra fields on stored rows (e.g. `uploadedAt`, `expiresAt`,
 * `storageProvider`) without rejecting the whole payload.
 */
export const userFileSchema = z
  .object({
    id: z.string().optional().default(''),
    name: z.string().min(1),
    url: z.string().optional().default(''),
    size: z.coerce.number().nonnegative(),
    type: z.string().optional().default('application/octet-stream'),
    key: z.string().min(1),
    context: z.string().optional(),
    base64: z.string().optional(),
  })
  .passthrough()

/** A single PII redaction rule targeting one scope (all workspaces, or one). */
export const piiRedactionRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(100).optional(),
  /** Presidio entity types to mask. Empty = redact nothing for this scope. */
  entityTypes: z.array(z.string().min(1, 'Entity type cannot be empty')).max(100),
  /** null = all workspaces; otherwise the single targeted workspace. */
  workspaceId: z.string().min(1).nullable(),
  /** Language whose Presidio recognizers apply; defaults to English. */
  language: z.enum(PII_LANGUAGE_CODES).optional(),
})

export type PiiRedactionRule = z.output<typeof piiRedactionRuleSchema>

/**
 * Enterprise PII redaction policy applied to workflow logs on persist. Each
 * scope is unique: at most one all-workspaces rule (`workspaceId: null`) and at
 * most one rule per workspace — resolution is most-specific-wins, so duplicate
 * scopes would make masking depend on array order.
 */
export const piiRedactionSettingsSchema = z.object({
  rules: z
    .array(piiRedactionRuleSchema)
    .max(1000)
    .refine(
      (rules) => {
        const scopes = rules.map((r) => r.workspaceId ?? '__all__')
        return new Set(scopes).size === scopes.length
      },
      {
        message:
          'Each workspace (and the all-workspaces default) may have at most one PII redaction rule.',
      }
    ),
})

export type PiiRedactionSettings = z.output<typeof piiRedactionSettingsSchema>

/** Retention hours bound: 1 day to ~5 years, in hours. */
const retentionOverrideHoursSchema = z.number().int().min(24).max(43800).nullable().optional()

/**
 * A per-workspace override of the org retention hours. Each field is tri-state:
 * omitted = inherit the org value; a number = that workspace's retention in
 * hours; `null` = forever (never delete).
 */
export const retentionOverrideSchema = z.object({
  workspaceId: workspaceIdSchema,
  logRetentionHours: retentionOverrideHoursSchema,
  softDeleteRetentionHours: retentionOverrideHoursSchema,
  taskCleanupHours: retentionOverrideHoursSchema,
})

export type RetentionOverride = z.output<typeof retentionOverrideSchema>

/**
 * Per-workspace retention overrides. Each workspace appears at most once —
 * resolution is workspace-override-then-org-default, so duplicate workspaces
 * would make the effective value depend on array order.
 */
export const retentionOverridesSchema = z
  .array(retentionOverrideSchema)
  .max(1000)
  .refine(
    (overrides) => {
      const ids = overrides.map((o) => o.workspaceId)
      return new Set(ids).size === ids.length
    },
    { message: 'Each workspace may have at most one retention override.' }
  )

export type RetentionOverrides = z.output<typeof retentionOverridesSchema>

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
