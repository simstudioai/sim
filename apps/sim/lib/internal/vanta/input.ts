import { z } from 'zod'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const VANTA_MAX_TRANSFER_BYTES = 100 * 1024 * 1024
export const VANTA_MAX_UPLOAD_BASE64_LENGTH = Math.ceil(VANTA_MAX_TRANSFER_BYTES / 3) * 4

export const vantaCredentialInputSchema = z.object({
  accessToken: z.string().min(1, 'Connect a Vanta credential before running this operation'),
  apiDomain: z.enum(['https://api.vanta.com', 'https://api.vanta-gov.com']),
})

const requiredId = (label: string) => z.string().trim().min(1, `${label} is required`)

export const vantaUploadDocumentFileInputSchema = vantaCredentialInputSchema.extend({
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

export const vantaDownloadDocumentFileInputSchema = vantaCredentialInputSchema.extend({
  documentId: requiredId('Document ID'),
  uploadedFileId: requiredId('Uploaded file ID'),
})

export type VantaUploadDocumentFileInput = z.output<typeof vantaUploadDocumentFileInputSchema>
export type VantaDownloadDocumentFileInput = z.output<typeof vantaDownloadDocumentFileInputSchema>
