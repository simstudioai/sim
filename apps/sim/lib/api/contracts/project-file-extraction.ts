import { z } from 'zod'
import { nonEmptyIdSchema } from '@/lib/api/contracts/primitives'
import { projectFileParamsSchema } from '@/lib/api/contracts/project-files'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { extractWorkspaceFileResponseSchema } from '@/lib/api/contracts/workspace-files'

export const extractProjectFileResponseSchema = extractWorkspaceFileResponseSchema.extend({
  folderId: nonEmptyIdSchema,
  folderDisplayPath: z.string(),
})
export type ExtractProjectFileResponse = z.output<typeof extractProjectFileResponseSchema>

export const extractProjectFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/projects/[id]/files/[fileId]/extract',
  params: projectFileParamsSchema,
  response: { mode: 'json', schema: extractProjectFileResponseSchema },
})
