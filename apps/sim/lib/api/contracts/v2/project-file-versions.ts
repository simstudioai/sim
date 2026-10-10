import { z } from 'zod'
import { noInputSchema, versionNumberPathSchema } from '@/lib/api/contracts/primitives'
import {
  deleteProjectFileVersionResponseSchema,
  listProjectFileVersionsQuerySchema,
  projectFileVersionSchema,
  revertProjectFileVersionBodySchema,
} from '@/lib/api/contracts/project-file-versions'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { writtenFileRevisionSchema } from '@/lib/api/contracts/v2/files'
import {
  v2ProjectFileParamsSchema,
  v2ProjectFileSchema,
} from '@/lib/api/contracts/v2/project-files'
import { v2CursorListResponse, v2DataResponse } from '@/lib/api/contracts/v2/shared'

export const v2ProjectFileVersionParamsSchema = v2ProjectFileParamsSchema.extend({
  version: versionNumberPathSchema.describe('Version number.'),
})
export type V2ProjectFileVersionParams = z.input<typeof v2ProjectFileVersionParamsSchema>
export const v2RevertProjectFileVersionResultSchema = z.object({
  reverted: z.boolean().describe('False if the selected version is already current.'),
  file: v2ProjectFileSchema,
  version: projectFileVersionSchema.describe('The current version after the revert.'),
  revision: writtenFileRevisionSchema,
})
export type V2RevertProjectFileVersionResult = z.output<
  typeof v2RevertProjectFileVersionResultSchema
>

export const v2ListProjectFileVersionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/projects/[projectId]/files/[fileId]/versions',
  params: v2ProjectFileParamsSchema,
  query: listProjectFileVersionsQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(projectFileVersionSchema) },
})
export const v2GetProjectFileVersionContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/projects/[projectId]/files/[fileId]/versions/[version]',
  params: v2ProjectFileVersionParamsSchema,
  query: noInputSchema,
  response: { mode: 'json', schema: v2DataResponse(projectFileVersionSchema) },
})
export const v2ReadProjectFileVersionContentContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/projects/[projectId]/files/[fileId]/versions/[version]/content',
  params: v2ProjectFileVersionParamsSchema,
  query: noInputSchema,
  response: { mode: 'binary' },
})
export const v2RevertProjectFileVersionContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/projects/[projectId]/files/[fileId]/versions/[version]/revert',
  params: v2ProjectFileVersionParamsSchema,
  query: noInputSchema,
  body: revertProjectFileVersionBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2RevertProjectFileVersionResultSchema) },
})
export const v2DeleteProjectFileVersionContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/projects/[projectId]/files/[fileId]/versions/[version]',
  params: v2ProjectFileVersionParamsSchema,
  query: noInputSchema,
  response: { mode: 'json', schema: v2DataResponse(deleteProjectFileVersionResponseSchema) },
})
