import { z } from 'zod'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const boxUploadFileInputSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  parentFolderId: z.string().min(1, 'Parent folder ID is required'),
  file: FileInputSchema.optional().nullable(),
  fileContent: z.string().optional().nullable(),
  fileName: z.string().optional().nullable(),
})

export type BoxUploadFileInput = z.output<typeof boxUploadFileInputSchema>
