import { z } from 'zod'
import { workflowIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

const inputFieldSchema = z.object({
  /** Stable per-field id — preserved so client block configs key sub-blocks on it
   *  (rename-safe wiring) instead of the display name. Absent on legacy fields. */
  id: z.string().optional(),
  name: z.string(),
  type: z.string(),
  description: z.string().optional(),
  /** Consumer-facing placeholder hint (curated inputs only). */
  placeholder: z.string().optional(),
})

/**
 * The only authored per-input datum: a placeholder, keyed by the source Start
 * field's stable `id`. The field's name/type/description are NOT stored — they're
 * always derived from the live deployed Start (so they can't go stale), and this
 * map only supplies the consumer-facing placeholder hint.
 */
const inputPlaceholderSchema = z.object({
  id: z.string().min(1),
  placeholder: z.string().max(200).optional(),
})

export type CustomBlockInputPlaceholder = z.input<typeof inputPlaceholderSchema>

/** A curated output: a child-workflow block output (blockId + dot-path) exposed under `name`. */
const exposedOutputSchema = z.object({
  blockId: z.string().min(1),
  path: z.string().min(1),
  name: z.string().min(1).max(60),
})

export const customBlockSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  workflowId: z.string(),
  /** Name of the bound source workflow (for display; the source can't be changed). */
  workflowName: z.string(),
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

export const publishCustomBlockBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  workflowId: workflowIdSchema,
  name: z.string().min(1, 'Name is required').max(60, 'Name must be 60 characters or fewer'),
  description: z.string().max(280, 'Description must be 280 characters or fewer').default(''),
  /** Uploaded icon image URL; omit for the default icon. */
  iconUrl: z.string().min(1).max(2048).optional(),
  /** Per-input placeholder hints keyed by Start field id; the field set itself is always derived from the deployment. */
  inputs: z.array(inputPlaceholderSchema).max(50).optional(),
  /** Curated outputs; omit/empty to expose the child's whole result. */
  exposedOutputs: z.array(exposedOutputSchema).max(50).optional(),
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
    /** A URL sets/replaces the icon; `null` clears it (default icon). */
    iconUrl: z.string().min(1).max(2048).nullable().optional(),
    inputs: z.array(inputPlaceholderSchema).max(50).optional(),
    exposedOutputs: z.array(exposedOutputSchema).max(50).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' })

export type UpdateCustomBlockBody = z.input<typeof updateCustomBlockBodySchema>

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
