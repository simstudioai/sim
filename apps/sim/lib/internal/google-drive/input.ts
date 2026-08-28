import { z } from 'zod'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

const googleAccessTokenSchema = z.string().min(1, 'Access token is required')

export const googleDriveUploadInputSchema = z.object({
  accessToken: googleAccessTokenSchema,
  fileName: z.string().min(1, 'File name is required'),
  file: RawFileInputSchema.optional().nullable(),
  content: z.string().optional(),
  mimeType: z.string().optional().nullable(),
  folderId: z.string().optional().nullable(),
})

export const googleDriveDownloadInputSchema = z.object({
  accessToken: googleAccessTokenSchema,
  fileId: z.string().min(1, 'File ID is required'),
  mimeType: z.string().optional().nullable(),
  fileName: z.string().optional().nullable(),
  includeRevisions: z.boolean().optional().default(true),
})

export const googleDriveExportInputSchema = z.object({
  accessToken: googleAccessTokenSchema,
  fileId: z.string().min(1, 'File ID is required'),
  mimeType: z.string().min(1, 'Target export MIME type is required'),
  fileName: z.string().optional().nullable(),
})

export const googleDriveMoveInputSchema = z.object({
  accessToken: googleAccessTokenSchema,
  fileId: z.string().trim().min(1, 'File ID is required'),
  destinationFolderId: z.string().trim().min(1, 'Destination folder ID is required'),
  removeFromCurrent: z.boolean().optional().default(true),
})

export type GoogleDriveUploadInput = z.output<typeof googleDriveUploadInputSchema>
export type GoogleDriveDownloadInput = z.output<typeof googleDriveDownloadInputSchema>
export type GoogleDriveExportInput = z.output<typeof googleDriveExportInputSchema>
export type GoogleDriveMoveInput = z.output<typeof googleDriveMoveInputSchema>
