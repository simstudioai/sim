import { z } from 'zod'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

const excelCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const excelRowSchema = z.array(excelCellSchema)

export const oneDriveUploadInputSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  fileName: z.string().min(1, 'File name is required'),
  file: RawFileInputSchema.optional().nullable(),
  content: z.string().optional().nullable(),
  folderId: z.string().optional().nullable(),
  mimeType: z.string().optional().nullable(),
  values: z
    .union([z.string(), z.array(excelRowSchema), z.array(z.record(z.string(), excelCellSchema))])
    .optional()
    .nullable(),
  conflictBehavior: z.enum(['fail', 'replace', 'rename']).optional().nullable(),
})

export type OneDriveUploadInput = z.infer<typeof oneDriveUploadInputSchema>
