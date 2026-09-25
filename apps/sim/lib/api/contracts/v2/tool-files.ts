import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const v2DownloadToolFileQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace in which to authorize the download.'),
    fileId: z
      .string()
      .min(1, 'fileId cannot be empty')
      .max(2048, 'fileId is too long')
      .describe(
        'The file.id returned by a direct tool call, with context copilot. Workflow output files use Download Workflow Run File instead.'
      ),
  })
  .strict()

export type V2DownloadToolFileQuery = z.input<typeof v2DownloadToolFileQuerySchema>

export const v2DownloadToolFileContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/tools/files/download',
  query: v2DownloadToolFileQuerySchema,
  response: { mode: 'binary' },
})
