import { z } from 'zod'
import { noInputSchema, versionNumberPathSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2FileVersionSchema,
  v2ListFileVersionsQuerySchema,
  v2RevertFileVersionBodySchema,
} from '@/lib/api/contracts/v2/file-versions'
import { writtenFileRevisionSchema } from '@/lib/api/contracts/v2/files'
import { workspaceFileParamsSchema } from '@/lib/api/contracts/workspace-files'

const workspaceFileVersionParamsSchema = workspaceFileParamsSchema.extend({
  version: versionNumberPathSchema,
})
const listWorkspaceFileVersionsQuerySchema = v2ListFileVersionsQuerySchema.omit({
  workspaceId: true,
})
const listWorkspaceFileVersionsResponseSchema = z.object({
  versions: z.array(v2FileVersionSchema),
  revision: writtenFileRevisionSchema,
  nextCursor: z.string().nullable(),
})
export type ListWorkspaceFileVersionsResponse = z.output<
  typeof listWorkspaceFileVersionsResponseSchema
>
const revertWorkspaceFileVersionBodySchema = v2RevertFileVersionBodySchema
  .omit({ workspaceId: true })
  .extend({ expectedRevision: z.string().min(1).max(1024).optional() })
export type RevertWorkspaceFileVersionBody = z.input<typeof revertWorkspaceFileVersionBodySchema>
const revertWorkspaceFileVersionResponseSchema = z.object({
  reverted: z.boolean(),
  revision: writtenFileRevisionSchema,
})

export const listWorkspaceFileVersionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/files/[fileId]/versions',
  params: workspaceFileParamsSchema,
  query: listWorkspaceFileVersionsQuerySchema,
  response: { mode: 'json', schema: listWorkspaceFileVersionsResponseSchema },
})
export const downloadWorkspaceFileVersionContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/files/[fileId]/versions/[version]/content',
  params: workspaceFileVersionParamsSchema,
  query: noInputSchema,
  response: { mode: 'binary' },
})
export const revertWorkspaceFileVersionContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/files/[fileId]/versions/[version]/revert',
  params: workspaceFileVersionParamsSchema,
  query: noInputSchema,
  body: revertWorkspaceFileVersionBodySchema,
  response: { mode: 'json', schema: revertWorkspaceFileVersionResponseSchema },
})
