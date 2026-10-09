import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { workspaceFileFoldersParamsSchema } from '@/lib/api/contracts/workspace-file-folders'
import { MAX_FOLDER_PATH_SEGMENTS } from '@/lib/folders/paths'
import { MAX_UPLOAD_DIRECTORIES } from '@/lib/workspace-files/upload-directory-plan'

const uploadDirectoryPathSchema = z
  .array(z.string().min(1).max(4096))
  .min(1)
  .max(MAX_FOLDER_PATH_SEGMENTS)

const prepareUploadFoldersBodySchema = z.object({
  targetFolderId: z.string().min(1).max(100).nullable(),
  paths: z.array(uploadDirectoryPathSchema).min(1).max(MAX_UPLOAD_DIRECTORIES),
})

const prepareUploadFoldersResponseSchema = z.object({
  success: z.boolean(),
  folders: z.array(z.object({ id: z.string(), name: z.string(), path: uploadDirectoryPathSchema })),
})

export type PrepareUploadFoldersBody = z.input<typeof prepareUploadFoldersBodySchema>

export const prepareUploadFoldersContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/files/folders/prepare-upload',
  params: workspaceFileFoldersParamsSchema,
  body: prepareUploadFoldersBodySchema,
  response: { mode: 'json', schema: prepareUploadFoldersResponseSchema },
})
