import { z } from 'zod'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const dataverseUploadFileInputSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  environmentUrl: z.string().min(1, 'Environment URL is required'),
  entitySetName: z.string().min(1, 'Entity set name is required'),
  recordId: z.string().min(1, 'Record ID is required'),
  fileColumn: z.string().min(1, 'File column is required'),
  fileName: z.string().min(1, 'File name is required'),
  file: RawFileInputSchema.optional().nullable(),
  fileContent: z.string().optional().nullable(),
})

export type DataverseUploadFileInput = z.output<typeof dataverseUploadFileInputSchema>
