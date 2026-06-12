import { z } from 'zod'
import { deploymentVersionMetadataFieldsSchema } from '@/lib/api/contracts/deployments'
import { workflowIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { genericToolResponseSchema } from '@/lib/api/contracts/tools/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'

/** Bounded to the Postgres `integer` range of `workflow_deployment_version.version`. */
const versionSchema = z
  .number()
  .int('Version must be an integer')
  .min(1, 'Version must be a positive integer')
  .max(2147483647, 'Version is out of range')

export const deploymentsDeployBodySchema = z.object({
  workflowId: workflowIdSchema,
  workspaceId: workspaceIdSchema,
  name: deploymentVersionMetadataFieldsSchema.shape.name,
  description: deploymentVersionMetadataFieldsSchema.shape.description,
})

export type DeploymentsDeployBody = z.input<typeof deploymentsDeployBodySchema>

export const deploymentsDeployContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/deployments/deploy',
  body: deploymentsDeployBodySchema,
  response: {
    mode: 'json',
    schema: genericToolResponseSchema,
  },
})

export const deploymentsUndeployBodySchema = z.object({
  workflowId: workflowIdSchema,
  workspaceId: workspaceIdSchema,
})

export type DeploymentsUndeployBody = z.input<typeof deploymentsUndeployBodySchema>

export const deploymentsUndeployContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/deployments/undeploy',
  body: deploymentsUndeployBodySchema,
  response: {
    mode: 'json',
    schema: genericToolResponseSchema,
  },
})

export const deploymentsPromoteBodySchema = z.object({
  workflowId: workflowIdSchema,
  workspaceId: workspaceIdSchema,
  version: versionSchema,
})

export type DeploymentsPromoteBody = z.input<typeof deploymentsPromoteBodySchema>

export const deploymentsPromoteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/deployments/promote',
  body: deploymentsPromoteBodySchema,
  response: {
    mode: 'json',
    schema: genericToolResponseSchema,
  },
})

export const deploymentsListVersionsQuerySchema = z.object({
  workflowId: workflowIdSchema,
  workspaceId: workspaceIdSchema,
})

export type DeploymentsListVersionsQuery = z.input<typeof deploymentsListVersionsQuerySchema>

export const deploymentsListVersionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/tools/deployments/versions',
  query: deploymentsListVersionsQuerySchema,
  response: {
    mode: 'json',
    schema: genericToolResponseSchema,
  },
})

export const deploymentsGetVersionQuerySchema = z.object({
  workflowId: workflowIdSchema,
  workspaceId: workspaceIdSchema,
  version: z.coerce.number().pipe(versionSchema),
})

export type DeploymentsGetVersionQuery = z.input<typeof deploymentsGetVersionQuerySchema>

export const deploymentsGetVersionContract = defineRouteContract({
  method: 'GET',
  path: '/api/tools/deployments/version',
  query: deploymentsGetVersionQuerySchema,
  response: {
    mode: 'json',
    schema: genericToolResponseSchema,
  },
})
