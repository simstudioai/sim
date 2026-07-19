import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'

/**
 * Per-viewer block visibility projection (see
 * `@/lib/core/config/block-visibility`): which `preview: true` block types this
 * viewer may see, which types are kill-switched, and which revealed types carry
 * the " (Preview)" display tag.
 */

const getBlockVisibilityQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
})

export type GetBlockVisibilityQuery = z.input<typeof getBlockVisibilityQuerySchema>

const blockVisibilityResponseSchema = z.object({
  /** Preview block types revealed to this viewer. */
  revealed: z.array(z.string()),
  /** Block types kill-switched (hidden from discovery) for this viewer. */
  disabled: z.array(z.string()),
  /** Revealed types not globally GA — displayed with a " (Preview)" suffix. */
  previewTagged: z.array(z.string()),
})

export type BlockVisibilityResponse = z.output<typeof blockVisibilityResponseSchema>

export const getBlockVisibilityContract = defineRouteContract({
  method: 'GET',
  path: '/api/blocks/visibility',
  query: getBlockVisibilityQuerySchema,
  response: {
    mode: 'json',
    schema: blockVisibilityResponseSchema,
  },
})
