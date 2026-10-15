import { z } from 'zod'
import { noInputSchema, versionNumberPathSchema } from '@/lib/api/contracts/primitives'
import { projectFileParamsSchema, projectFileRecordSchema } from '@/lib/api/contracts/project-files'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2DeleteFileVersionResultSchema,
  v2FileVersionSchema,
  v2ListFileVersionsQuerySchema,
  v2RevertFileVersionBodySchema,
} from '@/lib/api/contracts/v2/file-versions'
import { writtenFileRevisionSchema } from '@/lib/api/contracts/v2/files'

export const projectFileVersionSchema = v2FileVersionSchema.meta({
  id: 'ProjectFileVersion',
  title: 'Project file version',
  description: 'One recorded version of a shared Project file.',
})
const projectFileVersionParamsSchema = projectFileParamsSchema.extend({
  version: versionNumberPathSchema.describe('Version number.'),
})
export const listProjectFileVersionsQuerySchema = v2ListFileVersionsQuerySchema.omit({
  workspaceId: true,
})
const listProjectFileVersionsResponseSchema = z.object({
  revision: writtenFileRevisionSchema,
  versions: z.array(projectFileVersionSchema),
  nextCursor: z.string().nullable(),
})
const getProjectFileVersionResponseSchema = z.object({ version: projectFileVersionSchema })
export const revertProjectFileVersionBodySchema = v2RevertFileVersionBodySchema.omit({
  workspaceId: true,
})
const revertProjectFileVersionResponseSchema = z.object({
  reverted: z.boolean(),
  file: projectFileRecordSchema,
  version: projectFileVersionSchema,
  revision: writtenFileRevisionSchema,
})
export const deleteProjectFileVersionResponseSchema = v2DeleteFileVersionResultSchema.extend({
  deleted: z
    .literal(true)
    .describe(
      'The version is no longer available; stored-object cleanup is retried asynchronously when needed.'
    ),
})

export const listProjectFileVersionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/projects/[id]/files/[fileId]/versions',
  params: projectFileParamsSchema,
  query: listProjectFileVersionsQuerySchema,
  response: { mode: 'json', schema: listProjectFileVersionsResponseSchema },
})
export const getProjectFileVersionContract = defineRouteContract({
  method: 'GET',
  path: '/api/projects/[id]/files/[fileId]/versions/[version]',
  params: projectFileVersionParamsSchema,
  query: noInputSchema,
  response: { mode: 'json', schema: getProjectFileVersionResponseSchema },
})
export const readProjectFileVersionContentContract = defineRouteContract({
  method: 'GET',
  path: '/api/projects/[id]/files/[fileId]/versions/[version]/content',
  params: projectFileVersionParamsSchema,
  query: noInputSchema,
  response: { mode: 'binary' },
})
export const revertProjectFileVersionContract = defineRouteContract({
  method: 'POST',
  path: '/api/projects/[id]/files/[fileId]/versions/[version]/revert',
  params: projectFileVersionParamsSchema,
  query: noInputSchema,
  body: revertProjectFileVersionBodySchema,
  response: { mode: 'json', schema: revertProjectFileVersionResponseSchema },
})
export const deleteProjectFileVersionContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/projects/[id]/files/[fileId]/versions/[version]',
  params: projectFileVersionParamsSchema,
  query: noInputSchema,
  response: { mode: 'json', schema: deleteProjectFileVersionResponseSchema },
})
