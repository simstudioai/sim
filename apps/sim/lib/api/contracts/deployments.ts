import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { workflowIdParamsSchema } from '@/lib/api/contracts/workflows'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const deployedWorkflowStateSchema = z.custom<WorkflowState>(
  (value) => typeof value === 'object' && value !== null,
  'Expected workflow state'
)

const deploymentVersionParamsSchema = z.object({
  id: z.string().min(1, 'Invalid workflow ID'),
  version: z.coerce.number().int().positive(),
})

const deploymentVersionOrActiveParamsSchema = z.object({
  id: z.string().min(1, 'Invalid workflow ID'),
  version: z.union([z.number().int().positive(), z.literal('active')]),
})

const deploymentVersionRouteParamsSchema = z.object({
  id: z.string().min(1, 'Invalid workflow ID'),
  version: z.string().min(1, 'Invalid version'),
})

const updatePublicApiBodySchema = z.object({
  isPublicApi: z.boolean(),
})

type UpdatePublicApiBody = z.input<typeof updatePublicApiBodySchema>

const deploymentVersionMetadataFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name cannot be empty')
    .max(100, 'Name must be 100 characters or less')
    .optional(),
  description: z
    .string()
    .trim()
    .max(2000, 'Description must be 2000 characters or less')
    .nullable()
    .optional(),
})
const updateDeploymentVersionMetadataBodySchema = deploymentVersionMetadataFieldsSchema.refine(
  (data) => data.name !== undefined || data.description !== undefined,
  {
    message: 'At least one of name or description must be provided',
  }
)

type UpdateDeploymentVersionMetadataBody = z.input<typeof updateDeploymentVersionMetadataBodySchema>

const activateDeploymentVersionBodySchema = z.object({
  isActive: z.literal(true),
})

type ActivateDeploymentVersionBody = z.input<typeof activateDeploymentVersionBodySchema>

const deploymentVersionPatchBodySchema = deploymentVersionMetadataFieldsSchema
  .extend({
    isActive: z.literal(true).optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.description !== undefined || data.isActive === true,
    {
      message: 'At least one of name, description, or isActive must be provided',
    }
  )

const deploymentInfoResponseSchema = z.object({
  isDeployed: z.boolean(),
  deployedAt: z.string().nullable().optional(),
  apiKey: z.string().nullable().optional(),
  needsRedeployment: z.boolean().optional(),
  isPublicApi: z.boolean().optional(),
  warnings: z.array(z.string()).optional(),
})

export type DeploymentInfoResponse = z.output<typeof deploymentInfoResponseSchema>
export type DeployWorkflowResponse = DeploymentInfoResponse
type UndeployWorkflowResponse = DeploymentInfoResponse

const deploymentVersionSchema = z.object({
  id: z.string(),
  version: z.number(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  isActive: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string().nullable().optional(),
  deployedBy: z.string().nullable().optional(),
})

type DeploymentVersion = z.output<typeof deploymentVersionSchema>

const deploymentVersionsResponseSchema = z.object({
  versions: z.array(deploymentVersionSchema),
})

export type DeploymentVersionsResponse = z.output<typeof deploymentVersionsResponseSchema>

const chatDeploymentStatusSchema = z.object({
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

const chatDetailSchema = z.object({
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

const updatePublicApiResponseSchema = z.object({
  isPublicApi: z.boolean(),
})

type UpdatePublicApiResponse = z.output<typeof updatePublicApiResponseSchema>

const deployedWorkflowStateResponseSchema = z.object({
  deployedState: deployedWorkflowStateSchema.nullable(),
})

type DeployedWorkflowStateResponse = z.output<typeof deployedWorkflowStateResponseSchema>

const updateDeploymentVersionMetadataResponseSchema = z.object({
  name: z.string().nullable(),
  description: z.string().nullable(),
})

export type UpdateDeploymentVersionMetadataResponse = z.output<
  typeof updateDeploymentVersionMetadataResponseSchema
>

const activateDeploymentVersionResponseSchema = z.object({
  success: z.literal(true),
  deployedAt: z.string(),
  warnings: z.array(z.string()).optional(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
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
