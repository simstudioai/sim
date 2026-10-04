import type { z } from 'zod'
import { noInputSchema } from '@/lib/api/contracts/primitives'
import { sharePasswordSchema } from '@/lib/api/contracts/public-shares'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2FileShareSchema,
  v2NullableFileShareSchema,
  v2UpsertFileShareBodySchema,
} from '@/lib/api/contracts/v2/files'
import { v2ProjectFileParamsSchema } from '@/lib/api/contracts/v2/project-files'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'

export const v2UpdateProjectFileShareBodySchema = v2UpsertFileShareBodySchema
  .omit({ workspaceId: true })
  .extend({
    password: sharePasswordSchema
      .optional()
      .describe(
        'Literal password of 15 to 1024 characters. Kept when omitted; enabling password access without a supplied or stored password is rejected.'
      ),
  })
export type V2UpdateProjectFileShareBody = z.input<typeof v2UpdateProjectFileShareBodySchema>

export const v2GetProjectFileShareContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/projects/[projectId]/files/[fileId]/share',
  params: v2ProjectFileParamsSchema,
  query: noInputSchema,
  response: { mode: 'json', schema: v2DataResponse(v2NullableFileShareSchema) },
})

export const v2UpdateProjectFileShareContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/projects/[projectId]/files/[fileId]/share',
  params: v2ProjectFileParamsSchema,
  query: noInputSchema,
  body: v2UpdateProjectFileShareBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2FileShareSchema) },
})
