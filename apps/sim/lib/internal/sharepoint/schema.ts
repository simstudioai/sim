import { z } from 'zod'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'

const accessTokenSchema = z.string().min(1, 'Access token is required')

export const sharePointDownloadFileInputSchema = z.object({
  accessToken: accessTokenSchema,
  driveId: z.string().min(1, 'Drive ID is required'),
  itemId: z.string().min(1, 'Item ID is required'),
  fileName: z.string().optional().nullable(),
})

export const sharePointUploadFileInputSchema = z.object({
  accessToken: accessTokenSchema,
  siteId: z.string().default('root'),
  driveId: z.string().optional().nullable(),
  folderPath: z.string().optional().nullable(),
  fileName: z.string().optional().nullable(),
  files: RawFileInputArraySchema.optional().nullable(),
})

export type SharePointDownloadFileInput = z.output<typeof sharePointDownloadFileInputSchema>
export type SharePointUploadFileInput = z.output<typeof sharePointUploadFileInputSchema>
