import type { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2FileSearchResultsSchema,
  v2SearchFileContentQuerySchema,
} from '@/lib/api/contracts/v2/files'
import { v2ProjectFilesParamsSchema } from '@/lib/api/contracts/v2/project-files'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'

export const v2SearchProjectFileContentQuerySchema = v2SearchFileContentQuerySchema
  .omit({ workspaceId: true })
  .extend({
    folderPaths: v2SearchFileContentQuerySchema.shape.folderPaths.describe(
      'Comma-separated folder paths within the Project. Omit to search the entire Project; index coverage applies to the selected folders.'
    ),
  })
export type V2SearchProjectFileContentQuery = z.output<typeof v2SearchProjectFileContentQuerySchema>

export const v2SearchProjectFileContentContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/projects/[projectId]/files/search',
  params: v2ProjectFilesParamsSchema,
  query: v2SearchProjectFileContentQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2FileSearchResultsSchema) },
})
