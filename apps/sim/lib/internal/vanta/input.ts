import { z } from 'zod'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const VANTA_MAX_TRANSFER_BYTES = 100 * 1024 * 1024
export const VANTA_MAX_UPLOAD_BASE64_LENGTH = Math.ceil(VANTA_MAX_TRANSFER_BYTES / 3) * 4

const vantaCredentialsSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client secret is required'),
  region: z.enum(['us', 'gov']).optional(),
})

const requiredId = (label: string) => z.string().trim().min(1, `${label} is required`)

export const vantaUploadDocumentFileInputSchema = vantaCredentialsSchema.extend({
  documentId: requiredId('Document ID'),
  file: FileInputSchema.optional().nullable(),
  fileContent: z
    .string()
    .max(VANTA_MAX_UPLOAD_BASE64_LENGTH, 'fileContent exceeds the 100MB upload limit')
    .nullish(),
  fileName: z.string().nullish(),
  mimeType: z.string().nullish(),
  description: z.string().nullish(),
  effectiveAtDate: z.string().nullish(),
})

export const vantaDownloadDocumentFileInputSchema = vantaCredentialsSchema.extend({
  documentId: requiredId('Document ID'),
  uploadedFileId: requiredId('Uploaded file ID'),
})

export type VantaUploadDocumentFileInput = z.output<typeof vantaUploadDocumentFileInputSchema>
export type VantaDownloadDocumentFileInput = z.output<typeof vantaDownloadDocumentFileInputSchema>
