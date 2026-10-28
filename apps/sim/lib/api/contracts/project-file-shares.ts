import { z } from 'zod'
import {
  projectFileCapabilitiesSchema,
  projectFileParamsSchema,
} from '@/lib/api/contracts/project-files'
import {
  shareAuthTypeSchema,
  shareRecordSchema,
  upsertFileShareBodySchema,
} from '@/lib/api/contracts/public-shares'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const projectFileSharePolicySchema = z.object({
  canPublish: z
    .boolean()
    .describe(
      'Whether current Project sharing policies permit publishing or updating an active share.'
    ),
  allowedAuthTypes: z
    .array(shareAuthTypeSchema)
    .max(4)
    .describe('Authentication modes permitted by every applicable active environment policy.'),
})
export type ProjectFileSharePolicy = z.output<typeof projectFileSharePolicySchema>
export const getProjectFileShareResponseSchema = z.object({
  share: shareRecordSchema.nullable(),
  policy: projectFileSharePolicySchema,
  capabilities: projectFileCapabilitiesSchema,
})
export type GetProjectFileShareResponse = z.output<typeof getProjectFileShareResponseSchema>
export const updateProjectFileShareBodySchema = upsertFileShareBodySchema
export type UpdateProjectFileShareBody = z.input<typeof updateProjectFileShareBodySchema>
export const updateProjectFileShareResponseSchema = z.object({ share: shareRecordSchema })
export type UpdateProjectFileShareResponse = z.output<typeof updateProjectFileShareResponseSchema>
export const getProjectFileShareContract = defineRouteContract({
  method: 'GET',
  path: '/api/projects/[id]/files/[fileId]/share',
  params: projectFileParamsSchema,
  response: { mode: 'json', schema: getProjectFileShareResponseSchema },
})
export const updateProjectFileShareContract = defineRouteContract({
  method: 'PUT',
  path: '/api/projects/[id]/files/[fileId]/share',
  params: projectFileParamsSchema,
  body: updateProjectFileShareBodySchema,
  response: { mode: 'json', schema: updateProjectFileShareResponseSchema },
})
