import { z } from 'zod'
import { workflowIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { isReservedOutputName } from '@/blocks/custom/build-config'

const inputFieldSchema = z.object({
  /** Stable per-field id — preserved so client block configs key sub-blocks on it
   *  (rename-safe wiring) instead of the display name. Absent on legacy fields. */
  id: z.string().optional(),
  name: z.string(),
  type: z.string(),
  description: z.string().optional(),
  /** Consumer-facing placeholder hint (curated inputs only). */
  placeholder: z.string().optional(),
  /** Consumers must fill this input (curated inputs only). */
  required: z.boolean().optional(),
})

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
const exposedOutputSchema = z.object({
  blockId: z.string().min(1),
  path: z.string().min(1),
  name: z.string().min(1).max(60),
})

/**
 * Publish/update variant: rejects reserved system output names (`success`,
 * `error`, `result`, `cost`) that would shadow the block's own projected fields.
 * The read schema stays lenient so rows that predate this validation still parse.
 */
const exposedOutputWriteSchema = exposedOutputSchema.extend({
  name: z
    .string()
    .min(1)
    .max(60)
    .refine((name) => !isReservedOutputName(name), {
      message: 'Output name is reserved (success, error, result, cost)',
    }),
})

export const customBlockSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  workflowId: z.string(),
  /** Name of the bound source workflow (for display; the source can't be changed). */
  workflowName: z.string(),
  /** Source workflow's home workspace id — used client-side to gate manage affordances. */
  workspaceId: z.string().nullable(),
  /** Name of the source workflow's home workspace (display only). */
  workspaceName: z.string().nullable(),
  type: z.string(),
  name: z.string(),
  description: z.string(),
  /** Uploaded icon image URL, or null for the default icon. */
  iconUrl: z.string().nullable(),
  enabled: z.boolean(),
  inputFields: z.array(inputFieldSchema),
  /** Curated outputs exposed to consumers; empty = expose the child's whole result. */
  exposedOutputs: z.array(exposedOutputSchema),
})

export type CustomBlock = z.output<typeof customBlockSchema>

export const listCustomBlocksQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
})

/**
 * Icon URLs are rendered as org-wide `<img>` sources, so only https URLs and
 * internal file-serve paths (what the icon upload UI stores) are accepted —
 * never data:/blob:/other schemes an admin could smuggle into shared metadata.
 * Shared with the copilot deploy_custom_block handler's pass-through branch.
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
  /** Curated outputs; omit/empty to expose the child's whole result. */
  exposedOutputs: z.array(exposedOutputWriteSchema).max(50).optional(),
})

export type PublishCustomBlockBody = z.input<typeof publishCustomBlockBodySchema>

export const customBlockIdParamsSchema = z.object({
  id: z.string().min(1),
})

export const updateCustomBlockBodySchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    description: z.string().max(280).optional(),
    enabled: z.boolean().optional(),
    /** A URL (https or internal serve path) sets/replaces the icon; `null` clears it (default icon). */
    iconUrl: iconUrlSchema.nullable().optional(),
    inputs: z.array(inputPlaceholderSchema).max(50).optional(),
    exposedOutputs: z.array(exposedOutputWriteSchema).max(50).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' })

export type UpdateCustomBlockBody = z.input<typeof updateCustomBlockBodySchema>

/**
 * How many workflows in the org place this block. Live editor state and the
 * active deployment snapshot can diverge, so a workflow counts when the block
 * appears in either; `deployedUsageCount` counts active deployments only.
 */
export const customBlockUsageCountsSchema = z.object({
  usageCount: z.number().int().min(0),
  deployedUsageCount: z.number().int().min(0),
})

export type CustomBlockUsageCounts = z.output<typeof customBlockUsageCountsSchema>

export const listCustomBlocksContract = defineRouteContract({
  method: 'GET',
  path: '/api/custom-blocks',
  query: listCustomBlocksQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      /** Whether this workspace can publish/use custom blocks (feature flag + enterprise plan). */
      enabled: z.boolean(),
      customBlocks: z.array(customBlockSchema),
    }),
  },
})

export const publishCustomBlockContract = defineRouteContract({
  method: 'POST',
  path: '/api/custom-blocks',
  body: publishCustomBlockBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ customBlock: customBlockSchema }),
  },
})

export const updateCustomBlockContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/custom-blocks/[id]',
  params: customBlockIdParamsSchema,
  body: updateCustomBlockBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true) }),
  },
})

export const deleteCustomBlockContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/custom-blocks/[id]',
  params: customBlockIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true) }),
  },
})

export const getCustomBlockUsageCountsContract = defineRouteContract({
  method: 'GET',
  path: '/api/custom-blocks/[id]/usages',
  params: customBlockIdParamsSchema,
  response: {
    mode: 'json',
    schema: customBlockUsageCountsSchema,
  },
})
