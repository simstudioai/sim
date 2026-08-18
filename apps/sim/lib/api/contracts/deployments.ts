import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { workflowIdParamsSchema } from '@/lib/api/contracts/workflows'
import {
  DEPLOYMENT_COMPONENT_STATUSES,
  DEPLOYMENT_OPERATION_ACTIONS,
  DEPLOYMENT_OPERATION_STATUSES,
} from '@/lib/workflows/deployment-lifecycle'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

export const deployedWorkflowStateSchema = z
  .custom<WorkflowState>(
    (value) => typeof value === 'object' && value !== null,
    'Expected workflow state'
  )
  .meta({
    id: 'DeployedWorkflowState',
    title: 'Deployed workflow state',
    description: 'Workflow graph snapshot pinned by a deployment version.',
    type: 'object',
    additionalProperties: true,
  })

/**
 * Upper bound of `workflow_deployment_version.version`, whose column is a
 * Postgres `integer`. A larger value has no row to address and overflows the
 * comparison instead of missing, so every schema carrying a deployment version
 * — path param, request body, or cursor payload — must be bounded by this.
 */
export const DEPLOYMENT_VERSION_MAX = 2147483647

/** A deployment version number, bounded to the range its column can hold. */
export const deploymentVersionNumberSchema = z
  .number()
  .int('version must be an integer')
  .min(1, 'version must be a positive integer')
  .max(DEPLOYMENT_VERSION_MAX, 'version is out of range')

/**
 * {@link deploymentVersionNumberSchema} for a path segment, which arrives as a
 * string. Spelled out rather than piped through the body schema because a
 * `ZodPipe` publishes none of its constraints to the generated OpenAPI document,
 * which would leave the documented parameter unbounded even though the runtime
 * check holds.
 */
const deploymentVersionPathSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(DEPLOYMENT_VERSION_MAX, 'version is out of range')

export const deploymentVersionParamsSchema = z.object({
  id: z.string().min(1, 'Invalid workflow ID'),
  version: deploymentVersionPathSchema,
})

export const deploymentVersionOrActiveParamsSchema = z.object({
  id: z.string().min(1, 'Invalid workflow ID'),
  version: z.union([deploymentVersionPathSchema, z.literal('active')]),
})

export const updatePublicApiBodySchema = z.object({
  isPublicApi: z.boolean(),
})

export type UpdatePublicApiBody = z.input<typeof updatePublicApiBodySchema>

export const deploymentVersionMetadataFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name cannot be empty')
    .max(100, 'Name must be 100 characters or less')
    .optional(),
  description: z.string().trim().max(50_000, 'Description is too long').nullable().optional(),
})
export const updateDeploymentVersionMetadataBodySchema =
  deploymentVersionMetadataFieldsSchema.refine(
    (data) => data.name !== undefined || data.description !== undefined,
    {
      message: 'At least one of name or description must be provided',
    }
  )

export type UpdateDeploymentVersionMetadataBody = z.input<
  typeof updateDeploymentVersionMetadataBodySchema
>

export const activateDeploymentVersionBodySchema = z.object({
  isActive: z.literal(true),
})

export type ActivateDeploymentVersionBody = z.input<typeof activateDeploymentVersionBodySchema>

export const deploymentOperationStatusSchema = z.enum(DEPLOYMENT_OPERATION_STATUSES)

export const deploymentComponentReadinessSchema = z
  .enum([...DEPLOYMENT_COMPONENT_STATUSES, 'not_applicable'])
  .describe('Readiness of one deployment side-effect component.')

export const deploymentReadinessSchema = z
  .object({
    webhooks: deploymentComponentReadinessSchema.describe('Webhook synchronization readiness.'),
    schedules: deploymentComponentReadinessSchema.describe('Schedule synchronization readiness.'),
    mcp: deploymentComponentReadinessSchema.describe('MCP synchronization readiness.'),
  })
  .meta({
    id: 'DeploymentReadiness',
    title: 'Deployment readiness',
    description: 'Readiness of the side effects required to activate a deployment.',
  })

export const deploymentOperationErrorSchema = z
  .object({
    code: z.string().describe('Stable deployment failure code.'),
    message: z.string().describe('Human-readable deployment failure message.'),
    retryable: z.boolean().describe('Whether retrying the deployment may succeed.'),
  })
  .meta({
    id: 'DeploymentOperationError',
    title: 'Deployment operation error',
    description: 'Failure details for a deployment lifecycle operation.',
  })

export const deploymentOperationSummarySchema = z
  .object({
    id: z.string().describe('Unique deployment operation identifier.'),
    deploymentVersionId: z.string().describe('Deployment version targeted by this operation.'),
    version: z.number().int().positive().describe('Numeric deployment version.'),
    action: z
      .enum(DEPLOYMENT_OPERATION_ACTIONS)
      .describe('Operation being performed on the deployment version.'),
    status: deploymentOperationStatusSchema.describe('Current deployment lifecycle status.'),
    isCurrent: z
      .boolean()
      .optional()
      .default(true)
      .describe('Whether this operation still describes the current deployment attempt.'),
    readiness: deploymentReadinessSchema,
    requestedAt: z
      .string()
      .describe('ISO 8601 timestamp when the deployment operation was requested.')
      .meta({ format: 'date-time' }),
    activatedAt: z
      .string()
      .nullable()
      .optional()
      .describe('ISO 8601 activation timestamp, or null before activation completes.')
      .meta({ format: 'date-time' }),
    error: deploymentOperationErrorSchema
      .nullable()
      .optional()
      .describe('Deployment failure details, or null when no failure occurred.'),
  })
  .meta({
    id: 'DeploymentOperationSummary',
    title: 'Deployment operation',
    description: 'Lifecycle state of a deployment or version-activation attempt.',
  })

export type DeploymentOperationSummary = z.output<typeof deploymentOperationSummarySchema>

export const activeDeploymentSummarySchema = z
  .object({
    deploymentVersionId: z.string().describe('Identifier of the active deployment version.'),
    version: z.number().int().positive().describe('Numeric active deployment version.'),
    deployedAt: z
      .string()
      .describe('ISO 8601 timestamp when this version became active.')
      .meta({ format: 'date-time' }),
  })
  .meta({
    id: 'ActiveDeploymentSummary',
    title: 'Active deployment',
    description: 'Summary of the workflow version currently serving API executions.',
  })

export const deploymentVersionPatchBodySchema = deploymentVersionMetadataFieldsSchema
  .extend({
    isActive: z.literal(true).optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.description !== undefined || data.isActive === true,
    {
      message: 'At least one of name, description, or isActive must be provided',
    }
  )

export const deploymentInfoResponseSchema = z.object({
  isDeployed: z.boolean(),
  deployedAt: z.string().nullable().optional(),
  apiKey: z.string().nullable().optional(),
  needsRedeployment: z.boolean().optional(),
  isPublicApi: z.boolean().optional(),
  warnings: z.array(z.string()).optional(),
  activeDeployment: activeDeploymentSummarySchema.nullable().optional(),
  latestDeploymentAttempt: deploymentOperationSummarySchema.nullable().optional(),
})

export type DeploymentInfoResponse = z.output<typeof deploymentInfoResponseSchema>
export type DeployWorkflowResponse = DeploymentInfoResponse
export type UndeployWorkflowResponse = DeploymentInfoResponse

export const deploymentVersionSchema = z.object({
  id: z.string(),
  version: z.number(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  isActive: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string().nullable().optional(),
  deployedBy: z.string().nullable().optional(),
  latestOperationStatus: deploymentOperationStatusSchema.nullable().optional(),
})

export type DeploymentVersion = z.output<typeof deploymentVersionSchema>

export const deploymentVersionsResponseSchema = z.object({
  versions: z.array(deploymentVersionSchema),
})

export type DeploymentVersionsResponse = z.output<typeof deploymentVersionsResponseSchema>

export const chatDeploymentStatusSchema = z.object({
  isDeployed: z.boolean(),
  deployment: z
    .object({
      id: z.string(),
      identifier: z.string(),
    })
    .passthrough()
    .nullable(),
})

export type ChatDeploymentStatus = z.output<typeof chatDeploymentStatusSchema>

export const chatDetailSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  description: z.preprocess((value) => value ?? '', z.string()),
  authType: z.enum(['public', 'password', 'email', 'sso']),
  allowedEmails: z.preprocess((value) => value ?? [], z.array(z.string())),
  outputConfigs: z.preprocess(
    (value) => value ?? [],
    z.array(
      z.object({
        blockId: z.string(),
        path: z.string(),
      })
    )
  ),
  includeThinking: z.preprocess((value) => value ?? false, z.boolean()),
  includeToolCalls: z.preprocess((value) => value ?? false, z.boolean()),
  customizations: z.preprocess(
    (value) => value ?? undefined,
    z
      .object({
        welcomeMessage: z.string().optional(),
        imageUrl: z.string().optional(),
        primaryColor: z.string().optional(),
      })
      .optional()
  ),
  isActive: z.boolean(),
  chatUrl: z.string(),
  hasPassword: z.boolean(),
})

export type ChatDetail = z.output<typeof chatDetailSchema>

export const updatePublicApiResponseSchema = z.object({
  isPublicApi: z.boolean(),
})

export type UpdatePublicApiResponse = z.output<typeof updatePublicApiResponseSchema>

export const deployedWorkflowStateResponseSchema = z.object({
  deployedState: deployedWorkflowStateSchema.nullable(),
})

export type DeployedWorkflowStateResponse = z.output<typeof deployedWorkflowStateResponseSchema>

export const updateDeploymentVersionMetadataResponseSchema = z.object({
  name: z.string().nullable(),
  description: z.string().nullable(),
})

export type UpdateDeploymentVersionMetadataResponse = z.output<
  typeof updateDeploymentVersionMetadataResponseSchema
>

export const activateDeploymentVersionResponseSchema = z.object({
  success: z.literal(true),
  deployedAt: z.string().nullable().optional(),
  warnings: z.array(z.string()).optional(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  activeDeployment: activeDeploymentSummarySchema.nullable().optional(),
  latestDeploymentAttempt: deploymentOperationSummarySchema.nullable().optional(),
})

export type ActivateDeploymentVersionResponse = z.output<
  typeof activateDeploymentVersionResponseSchema
>

export const getDeploymentInfoContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows/[id]/deploy',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: deploymentInfoResponseSchema,
  },
})

export const deployWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/workflows/[id]/deploy',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: deploymentInfoResponseSchema,
  },
})

export const undeployWorkflowContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workflows/[id]/deploy',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: deploymentInfoResponseSchema,
  },
})

export const updatePublicApiContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workflows/[id]/deploy',
  params: workflowIdParamsSchema,
  body: updatePublicApiBodySchema,
  response: {
    mode: 'json',
    schema: updatePublicApiResponseSchema,
  },
})

export const getDeployedWorkflowStateContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows/[id]/deployed',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: deployedWorkflowStateResponseSchema,
  },
})

export const listDeploymentVersionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows/[id]/deployments',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: deploymentVersionsResponseSchema,
  },
})

export const getDeploymentVersionStateContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows/[id]/deployments/[version]',
  params: deploymentVersionParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      deployedState: deployedWorkflowStateSchema,
    }),
  },
})

export const updateDeploymentVersionMetadataContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workflows/[id]/deployments/[version]',
  params: deploymentVersionParamsSchema,
  body: deploymentVersionPatchBodySchema,
  response: {
    mode: 'json',
    schema: updateDeploymentVersionMetadataResponseSchema,
  },
})

export const activateDeploymentVersionContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workflows/[id]/deployments/[version]',
  params: deploymentVersionParamsSchema,
  body: activateDeploymentVersionBodySchema,
  response: {
    mode: 'json',
    schema: activateDeploymentVersionResponseSchema,
  },
})

export const revertToDeploymentVersionContract = defineRouteContract({
  method: 'POST',
  path: '/api/workflows/[id]/deployments/[version]/revert',
  params: deploymentVersionOrActiveParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      message: z.string(),
      lastSaved: z.number(),
    }),
  },
})

export const getChatDeploymentStatusContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows/[id]/chat/status',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: chatDeploymentStatusSchema,
  },
})

export const getChatDetailContract = defineRouteContract({
  method: 'GET',
  path: '/api/chat/manage/[id]',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: chatDetailSchema,
  },
})
