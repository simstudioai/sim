import { z } from 'zod'
import {
  folderIdSchema,
  workspaceFileIdSchema,
  workspaceFileNameSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2FileSearchResultsSchema,
  v2SearchFileContentQuerySchema,
} from '@/lib/api/contracts/v2/files'
import { v2FolderPathInputSchema } from '@/lib/api/contracts/v2/shared'
import { workspaceFilesParamsSchema } from '@/lib/api/contracts/workspace-files'
import { FILE_SEARCH_MAX_RESULTS } from '@/lib/workspace-files/search/constants'

const searchWorkspaceFileContentQuerySchema = v2SearchFileContentQuerySchema
  .pick({ query: true, maxResults: true })
  .extend({ folderPath: v2FolderPathInputSchema.optional() })

export type SearchWorkspaceFileContentQuery = z.input<typeof searchWorkspaceFileContentQuerySchema>

const workspaceFileSearchMetadataSchema = z.object({
  id: workspaceFileIdSchema,
  name: workspaceFileNameSchema,
  folderId: folderIdSchema.nullable(),
})

export const searchWorkspaceFileContentResponseSchema = v2FileSearchResultsSchema.extend({
  files: z.array(workspaceFileSearchMetadataSchema).max(FILE_SEARCH_MAX_RESULTS),
})

export const searchWorkspaceFileContentContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/files/search',
  params: workspaceFilesParamsSchema,
  query: searchWorkspaceFileContentQuerySchema,
  response: { mode: 'json', schema: searchWorkspaceFileContentResponseSchema },
})
