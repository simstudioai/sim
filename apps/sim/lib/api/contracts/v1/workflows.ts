import { z } from 'zod'
import { booleanQueryFlagSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { workflowIdParamsSchema } from '@/lib/api/contracts/workflows'

export const v1ListWorkflowsQuerySchema = z.object({
  workspaceId: z.string().min(1),
  folderId: z.string().optional(),
  deployedOnly: booleanQueryFlagSchema.optional().default(false),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  cursor: z.string().optional(),
})

export type V1ListWorkflowsQuery = z.output<typeof v1ListWorkflowsQuerySchema>

/**
 * Generic wrapper used by v1 admin workflow list/detail responses. `data` is
 * the provider-shaped admin payload (varies per route) and `limits` is an
 * optional rate-limit envelope; both are intentionally `z.unknown()` here.
 * Tightening would require per-route discriminated unions and is tracked as
 * a follow-up.
 *
 * boundary-policy: this is the "validates nothing" alias form that the audit
 * script's `untyped-response` regex doesn't currently catch. Treat any new
 * wrapper of this shape the same way — either annotate at the contract use
 * site with `// untyped-response: <reason>` or replace with a concrete schema.
 */
const v1WorkflowApiResponseWithLimitsSchema = z
  .object({
    data: z.unknown(),
    limits: z.unknown().optional(),
  })
  .passthrough()

export const v1ListWorkflowsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/workflows',
  query: v1ListWorkflowsQuerySchema,
  response: {
    mode: 'json',
    schema: v1WorkflowApiResponseWithLimitsSchema,
  },
})

export const v1GetWorkflowContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/workflows/[id]',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v1WorkflowApiResponseWithLimitsSchema,
  },
})
