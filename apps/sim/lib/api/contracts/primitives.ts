import { z } from 'zod'
import { PII_LANGUAGE_CODES, stripNerEntities } from '@/lib/guardrails/pii-entities'
import { validateRegexPattern } from '@/lib/guardrails/validate_regex'

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
 * A `workspace_files.id` value. The column is a free-form `text` primary key, so
 * ids come in two shapes: UUID v4 (legacy rows and the `insertFileMetadata`
 * default) and the current `wf_<shortId>` form minted by the workspace upload
 * path. Both are drawn from `[A-Za-z0-9_-]`, so accept that charset rather than a
 * UUID-only schema — a `.uuid()` constraint here silently 400s every `wf_` file.
 */
export const workspaceFileIdSchema = z
  .string()
  .min(1, 'File ID is required')
  .max(128, 'File ID is too long')
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid file id')

/**
 * Reference to an image embedded in a document: either a workspace storage `key`
 * (serve-URL embeds) or a workspace file `id` (view-URL embeds) — exactly one. Shared
 * by the in-app and public inline-image routes, which resolve it within a workspace.
 */
export const inlineFileRefQuerySchema = z
  .object({
    key: z.string().min(1).max(512).optional(),
    fileId: workspaceFileIdSchema.optional(),
  })
  .refine((q) => (q.key ? 1 : 0) + (q.fileId ? 1 : 0) === 1, {
    message: 'Provide exactly one of `key` or `fileId`',
  })

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

/**
 * Per-stage redaction policy: which entity types to mask, in which language. An
 * enabled stage must name at least one entity type — "redact all" is not an
 * expressible policy, so `enabled: true` with an empty list (which would resolve
 * to off and silently skip masking) is rejected at the boundary.
 */
/**
 * A user-supplied custom regex pattern. `name` is a label; `regex` is matched
 * against text; matches are replaced with `replacement` wrapped in angle brackets
 * (`EMPLOYEE_ID` → `<EMPLOYEE_ID>`). Bounds guard the Presidio boundary
 * (ReDoS/oversized payloads).
 *
 * The `regex` is validated for both syntax and catastrophic-backtracking safety
 * here at the write boundary — not just in the editor — so an invalid or unsafe
 * pattern can never be persisted or reach Presidio (where it would abort the
 * batch on a 400, or time out and silently fail open, leaving PII unredacted).
 */
export const customPatternSchema = z.object({
  name: z.string().max(100, 'Pattern name is too long'),
  regex: z
    .string()
    .min(1, 'Pattern cannot be empty')
    .max(512, 'Pattern is too long')
    .superRefine((regex, ctx) => {
      const result = validateRegexPattern(regex)
      if (!result.valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: result.error ?? 'Invalid regex pattern',
        })
      }
    }),
  replacement: z.string().max(100, 'Replacement is too long'),
})

export type CustomPiiPattern = z.output<typeof customPatternSchema>

export const piiStagePolicySchema = z
  .object({
    enabled: z.boolean(),
    /** Presidio entity types to mask. Disabled stages may be empty. */
    entityTypes: z.array(z.string().min(1, 'Entity type cannot be empty')).max(100),
    /** Language whose Presidio recognizers apply; defaults to English. */
    language: z.enum(PII_LANGUAGE_CODES).optional(),
    /** User-supplied custom regex patterns applied alongside `entityTypes`. */
    customPatterns: z.array(customPatternSchema).max(20).optional(),
  })
  .refine(
    (stage) =>
      !stage.enabled || stage.entityTypes.length > 0 || (stage.customPatterns?.length ?? 0) > 0,
    {
      message: 'An enabled redaction stage must select at least one entity type or custom pattern.',
      path: ['entityTypes'],
    }
  )

export type PiiStagePolicy = z.output<typeof piiStagePolicySchema>

/**
 * The three redaction stages, each independently configured.
 *
 * Block outputs are regex-only: they run in-flight on Presidio's spaCy-free fast
 * path, so the spaCy-NER entities (PERSON/LOCATION/NRP/DATE_TIME) are stripped
 * here rather than rejected — a stored rule that still selects NER stays saveable
 * (migration-safe), and a blockOutputs stage left empty by the strip is disabled.
 */
export const piiStagesSchema = z
  .object({
    input: piiStagePolicySchema,
    blockOutputs: piiStagePolicySchema,
    logs: piiStagePolicySchema,
  })
  .transform((stages) => {
    const entityTypes = stripNerEntities(stages.blockOutputs.entityTypes)
    const customPatterns = stages.blockOutputs.customPatterns ?? []
    return {
      ...stages,
      blockOutputs: {
        ...stages.blockOutputs,
        entityTypes,
        enabled:
          stages.blockOutputs.enabled && (entityTypes.length > 0 || customPatterns.length > 0),
      },
    }
  })

export type PiiStages = z.output<typeof piiStagesSchema>

/**
 * A single PII redaction rule targeting one scope (all workspaces, or one).
 * New rules carry per-stage `stages`; legacy rows carry only the flat
 * `entityTypes`/`language` (resolved as logs-only). At least one must be present.
 */
export const piiRedactionRuleSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().max(100).optional(),
    /** null = all workspaces; otherwise the single targeted workspace. */
    workspaceId: z.string().min(1).nullable(),
    /** Per-stage policy (input / blockOutputs / logs). */
    stages: piiStagesSchema.optional(),
    /** Legacy flat policy (pre-stages). Retained for back-compat parse + migration. */
    entityTypes: z.array(z.string().min(1, 'Entity type cannot be empty')).max(100).optional(),
    language: z.enum(PII_LANGUAGE_CODES).optional(),
  })
  .refine((rule) => rule.stages !== undefined || rule.entityTypes !== undefined, {
    message: 'A PII redaction rule must define either stages or entityTypes.',
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
