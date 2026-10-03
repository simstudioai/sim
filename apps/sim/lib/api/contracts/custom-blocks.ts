import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  exposedOutputSchema,
  publishCustomBlockBodySchema,
  updateCustomBlockBodySchema,
} from '@/lib/workflows/custom-blocks/settings-input'

export type {
  CustomBlockInputPlaceholder,
  PublishCustomBlockBody,
  UpdateCustomBlockBody,
} from '@/lib/workflows/custom-blocks/settings-input'
export {
  isAllowedCustomBlockIconUrl,
  publishCustomBlockBodySchema,
  updateCustomBlockBodySchema,
} from '@/lib/workflows/custom-blocks/settings-input'

export const customBlockIdParamsSchema = z.object({ id: z.string().min(1) })

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
  /** Whether this block's runs are joined into consumers' traces, org-wide. */
  traceChildRuns: z.boolean(),
  inputFields: z.array(inputFieldSchema),
  /** Curated outputs exposed to consumers; empty = expose the child's whole result. */
  exposedOutputs: z.array(exposedOutputSchema),
})

export type CustomBlock = z.output<typeof customBlockSchema>

export const listCustomBlocksQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
})

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
