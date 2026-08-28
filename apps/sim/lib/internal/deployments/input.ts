import { z } from 'zod'
import { deploymentVersionMetadataFieldsSchema } from '@/lib/api/contracts/deployments'
import { workflowIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'

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

export type DeploymentsDeployBody = z.output<typeof deploymentsDeployBodySchema>

export const deploymentsUndeployBodySchema = z.object({
  workflowId: workflowIdSchema,
  workspaceId: workspaceIdSchema,
})

export type DeploymentsUndeployBody = z.output<typeof deploymentsUndeployBodySchema>

export const deploymentsPromoteBodySchema = z.object({
  workflowId: workflowIdSchema,
  workspaceId: workspaceIdSchema,
  version: versionSchema,
})

export type DeploymentsPromoteBody = z.output<typeof deploymentsPromoteBodySchema>

export const deploymentsListVersionsQuerySchema = z.object({
  workflowId: workflowIdSchema,
  workspaceId: workspaceIdSchema,
})

export type DeploymentsListVersionsQuery = z.output<typeof deploymentsListVersionsQuerySchema>

export const deploymentsGetVersionQuerySchema = z.object({
  workflowId: workflowIdSchema,
  workspaceId: workspaceIdSchema,
  version: z.coerce.number().pipe(versionSchema),
})

export type DeploymentsGetVersionQuery = z.output<typeof deploymentsGetVersionQuerySchema>
