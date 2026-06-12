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

/**
 * Optional version metadata accepted by the v1 deploy endpoint. The route
 * tolerates an absent/empty body, so this schema is validated by the handler
 * against a tolerant raw-JSON read instead of being attached to the contract.
 */
export const v1DeployWorkflowBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'name cannot be empty')
    .max(100, 'name must be 100 characters or less')
    .optional(),
  description: z
    .string()
    .trim()
    .max(2000, 'description must be 2000 characters or less')
    .optional(),
})

export type V1DeployWorkflowBody = z.input<typeof v1DeployWorkflowBodySchema>

/**
 * Optional rollback target accepted by the v1 rollback endpoint. When
 * `version` is omitted the route rolls back to the deployment version that
 * precedes the currently active one. Validated by the handler against a
 * tolerant raw-JSON read, so it is not attached to the contract.
 */
export const v1RollbackWorkflowBodySchema = z.object({
  version: z
    .number()
    .int('version must be an integer')
    .min(1, 'version must be a positive integer')
    .optional(),
})

export type V1RollbackWorkflowBody = z.input<typeof v1RollbackWorkflowBodySchema>

export const v1WorkflowDeploymentDataSchema = z.object({
  id: z.string(),
  isDeployed: z.boolean(),
  deployedAt: z.string().nullable(),
  version: z.number().optional(),
  warnings: z.array(z.string()),
})

export type V1WorkflowDeploymentData = z.output<typeof v1WorkflowDeploymentDataSchema>

const v1WorkflowDeploymentResponseSchema = z.object({
  data: v1WorkflowDeploymentDataSchema,
  limits: z.unknown().optional(),
})

export const v1DeployWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/workflows/[id]/deploy',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v1WorkflowDeploymentResponseSchema,
  },
})

export const v1UndeployWorkflowContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/workflows/[id]/deploy',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v1WorkflowDeploymentResponseSchema,
  },
})

export const v1RollbackWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/workflows/[id]/rollback',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v1WorkflowDeploymentResponseSchema,
  },
})
