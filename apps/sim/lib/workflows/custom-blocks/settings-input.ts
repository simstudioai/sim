import { z } from 'zod'
import { workflowIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { isReservedOutputName } from '@/blocks/custom/build-config'

/**
 * The authored per-input data: a placeholder and a required flag, keyed by the
 * source Start field's stable `id`. The field's name/type/description are NOT
 * stored — they're always derived from the live deployed Start (so they can't go
 * stale); an override whose field was removed from the Start is silently ignored.
 */
const inputPlaceholderSchema = z.object({
  id: z.string().min(1),
  placeholder: z.string().max(200).optional(),
  required: z.boolean().optional(),
})

export type CustomBlockInputPlaceholder = z.input<typeof inputPlaceholderSchema>

/** A curated output: a child-workflow block output (blockId + dot-path) exposed under `name`. */
export const exposedOutputSchema = z.object({
  blockId: z.string().min(1),
  path: z.string().min(1),
  name: z.string().min(1).max(60),
})

/**
 * Publish/update variant: rejects reserved system output names (`success`,
 * `error`, `cost`) that would shadow the block's own projected fields. The
 * read schema stays lenient so rows that predate this validation still parse.
 */
const exposedOutputWriteSchema = exposedOutputSchema.extend({
  name: z
    .string()
    .min(1)
    .max(60)
    .refine((name) => !isReservedOutputName(name), {
      message: 'Output name is reserved (success, error, cost)',
    }),
})

/**
 * Icon URLs are rendered as org-wide `<img>` sources, so only https URLs and
 * internal file-serve paths (what the icon upload UI stores) are accepted —
 * never data:/blob:/other schemes an admin could smuggle into shared metadata.
 * Shared with the copilot publish_custom_block handler's pass-through branch.
 */
export function isAllowedCustomBlockIconUrl(value: string): boolean {
  return value.startsWith('https://') || value.startsWith('/api/files/serve/')
}

const iconUrlSchema = z.string().min(1).max(2048).refine(isAllowedCustomBlockIconUrl, {
  message: 'iconUrl must be an https URL or an internal /api/files/serve/ path',
})

export const publishCustomBlockBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  workflowId: workflowIdSchema,
  name: z.string().min(1, 'Name is required').max(60, 'Name must be 60 characters or fewer'),
  description: z.string().max(280, 'Description must be 280 characters or fewer').default(''),
  /** Uploaded icon image URL (https or internal serve path); omit for the default icon. */
  iconUrl: iconUrlSchema.optional(),
  /** Per-input placeholder hints keyed by Start field id; the field set itself is always derived from the deployment. */
  inputs: z.array(inputPlaceholderSchema).max(50).optional(),
  /**
   * Curated outputs. REQUIRED: every field a consumer receives must be one the
   * publisher explicitly chose. There is deliberately no "expose everything"
   * fallback — the terminal block's raw state carries execution metadata
   * (an agent's `toolCalls`, `providerTiming.thinkingContent`, `cost`; a nested
   * workflow block's ids) that would cross the invocation boundary unchosen.
   */
  exposedOutputs: z
    .array(exposedOutputWriteSchema)
    .min(1, 'Select at least one output to expose to consumers')
    .max(50),
  /**
   * Joins this block's runs into consumers' traces, org-wide. Defaults FALSE: it is
   * the only policy guarding the source workflow's internals, so publishing must
   * never open them as a side effect of omitting a field.
   */
  traceChildRuns: z.boolean().default(false),
})

export type PublishCustomBlockBody = z.input<typeof publishCustomBlockBodySchema>

export const updateCustomBlockBodySchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    description: z.string().max(280).optional(),
    enabled: z.boolean().optional(),
    /** A URL (https or internal serve path) sets/replaces the icon; `null` clears it (default icon). */
    iconUrl: iconUrlSchema.nullable().optional(),
    inputs: z.array(inputPlaceholderSchema).max(50).optional(),
    /** Omit to leave the curated outputs unchanged; never settable to empty. */
    exposedOutputs: z
      .array(exposedOutputWriteSchema)
      .min(1, 'Select at least one output to expose to consumers')
      .max(50)
      .optional(),
    /** Omit to leave the trace policy unchanged. */
    traceChildRuns: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' })

export type UpdateCustomBlockBody = z.input<typeof updateCustomBlockBodySchema>
