import { z } from 'zod'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const dropboxUploadInputSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  path: z.string().trim().min(1, 'Destination path is required'),
  file: FileInputSchema.optional().nullable(),
  fileContent: z.string().optional().nullable(),
  fileName: z.string().optional().nullable(),
  mode: z.enum(['add', 'overwrite']).optional().nullable(),
  autorename: z.boolean().optional().nullable(),
  mute: z.boolean().optional().nullable(),
})

export type DropboxUploadInput = z.output<typeof dropboxUploadInputSchema>
