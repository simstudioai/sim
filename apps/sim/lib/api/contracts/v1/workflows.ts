import { z } from 'zod'
import {
  activeDeploymentSummarySchema,
  deploymentOperationSummarySchema,
  deploymentVersionMetadataFieldsSchema,
} from '@/lib/api/contracts/deployments'
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
 * Optional version metadata accepted by the v1 deploy endpoint. Field bounds
 * are shared with the UI deployment surface via
 * {@link deploymentVersionMetadataFieldsSchema}. The route tolerates an
 * absent/empty body, so this schema is validated by the handler against
 * `parseOptionalJsonBody` instead of being attached to the contract.
 */
export const v1DeployWorkflowBodySchema = z.object({
  name: deploymentVersionMetadataFieldsSchema.shape.name,
  description: deploymentVersionMetadataFieldsSchema.shape.description,
})

export type V1DeployWorkflowBody = z.input<typeof v1DeployWorkflowBodySchema>

/** Bounded to the Postgres `integer` range of `workflow_deployment_version.version`. */
const deploymentVersionNumberSchema = z
  .number()
  .int('version must be an integer')
  .min(1, 'version must be a positive integer')
  .max(2147483647, 'version is out of range')

/**
 * Optional rollback target accepted by the v1 rollback endpoint. When
 * `version` is omitted the route rolls back to the deployment version that
 * precedes the currently active one. Validated by the handler against
 * `parseOptionalJsonBody`, so it is not attached to the contract.
 */
export const v1RollbackWorkflowBodySchema = z.object({
  version: deploymentVersionNumberSchema.optional(),
})

export type V1RollbackWorkflowBody = z.input<typeof v1RollbackWorkflowBodySchema>

const v1DeploymentStateSchema = z.object({
  id: z.string(),
  isDeployed: z.boolean(),
  deployedAt: z.string().nullable(),
  warnings: z.array(z.string()),
})

/**
 * Deploy/rollback admit asynchronously: HTTP success means the attempt was
 * accepted, while `isDeployed` reflects whether a version is actually live.
 * `latestDeploymentAttempt` carries the lifecycle status
 * (preparing/activating/active/failed/superseded) so API consumers can poll
 * to a terminal state instead of guessing from `isDeployed` alone.
 */
const v1DeploymentLifecycleSchema = v1DeploymentStateSchema.extend({
  activeDeployment: activeDeploymentSummarySchema.nullable(),
  latestDeploymentAttempt: deploymentOperationSummarySchema.nullable(),
})

export const v1DeployWorkflowDataSchema = v1DeploymentLifecycleSchema.extend({
  version: z.number().optional(),
})

export type V1DeployWorkflowData = z.output<typeof v1DeployWorkflowDataSchema>

export const v1RollbackWorkflowDataSchema = v1DeploymentLifecycleSchema.extend({
  version: z.number(),
})

export type V1RollbackWorkflowData = z.output<typeof v1RollbackWorkflowDataSchema>

export type V1UndeployWorkflowData = z.output<typeof v1DeploymentStateSchema>

const withV1Limits = <T extends z.ZodType>(data: T) =>
  z.object({
    data,
    limits: z.unknown().optional(),
  })

export const v1DeployWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/workflows/[id]/deploy',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: withV1Limits(v1DeployWorkflowDataSchema),
  },
})

export const v1UndeployWorkflowContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/workflows/[id]/deploy',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: withV1Limits(v1DeploymentStateSchema),
  },
})

export const v1RollbackWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/workflows/[id]/rollback',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: withV1Limits(v1RollbackWorkflowDataSchema),
  },
})
