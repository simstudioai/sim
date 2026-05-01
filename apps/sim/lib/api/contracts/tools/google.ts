import { z } from 'zod'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { RawFileInputArraySchema, RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

export const googleAccessTokenSchema = z.string().min(1, 'Access token is required')
export const gmailMessageIdSchema = z.string().min(1, 'Message ID is required')

export const gmailMessageBodySchema = z.object({
  accessToken: googleAccessTokenSchema,
  messageId: gmailMessageIdSchema,
})

export const gmailLabelBodySchema = gmailMessageBodySchema.extend({
  labelIds: z.string().min(1, 'At least one label ID is required'),
})

export const gmailMoveBodySchema = gmailMessageBodySchema.extend({
  addLabelIds: z.string().min(1, 'At least one label to add is required'),
  removeLabelIds: z.string().optional().nullable(),
})

export const gmailMailBodySchema = z.object({
  accessToken: googleAccessTokenSchema,
  to: z.string().min(1, 'Recipient email is required'),
  subject: z.string().optional().nullable(),
  body: z.string().min(1, 'Email body is required'),
  contentType: z.enum(['text', 'html']).optional().nullable(),
  threadId: z.string().optional().nullable(),
  replyToMessageId: z.string().optional().nullable(),
  cc: z.string().optional().nullable(),
  bcc: z.string().optional().nullable(),
  attachments: RawFileInputArraySchema.optional().nullable(),
})

export const gmailEditDraftBodySchema = gmailMailBodySchema.extend({
  draftId: z.string().min(1, 'Draft ID is required'),
})

export const googleDriveUploadBodySchema = z.object({
  accessToken: googleAccessTokenSchema,
  fileName: z.string().min(1, 'File name is required'),
  file: RawFileInputSchema.optional().nullable(),
  mimeType: z.string().optional().nullable(),
  folderId: z.string().optional().nullable(),
})

export const googleDriveDownloadBodySchema = z.object({
  accessToken: googleAccessTokenSchema,
  fileId: z.string().min(1, 'File ID is required'),
  mimeType: z.string().optional().nullable(),
  fileName: z.string().optional().nullable(),
  includeRevisions: z.boolean().optional().default(true),
})

export const googleVaultDownloadExportFileBodySchema = z.object({
  accessToken: googleAccessTokenSchema,
  bucketName: z.string().min(1, 'Bucket name is required'),
  objectName: z.string().min(1, 'Object name is required'),
  fileName: z.string().optional().nullable(),
})

const toolJsonResponseSchema = z.unknown()

export const gmailAddLabelContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/gmail/add-label',
  body: gmailLabelBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const gmailArchiveContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/gmail/archive',
  body: gmailMessageBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const gmailDeleteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/gmail/delete',
  body: gmailMessageBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const gmailDraftContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/gmail/draft',
  body: gmailMailBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const gmailEditDraftContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/gmail/edit-draft',
  body: gmailEditDraftBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const gmailMarkReadContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/gmail/mark-read',
  body: gmailMessageBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const gmailMarkUnreadContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/gmail/mark-unread',
  body: gmailMessageBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const gmailMoveContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/gmail/move',
  body: gmailMoveBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const gmailRemoveLabelContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/gmail/remove-label',
  body: gmailLabelBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const gmailSendContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/gmail/send',
  body: gmailMailBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const gmailUnarchiveContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/gmail/unarchive',
  body: gmailMessageBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const googleDriveUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/google_drive/upload',
  body: googleDriveUploadBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const googleDriveDownloadContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/google_drive/download',
  body: googleDriveDownloadBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const googleVaultDownloadExportFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/google_vault/download-export-file',
  body: googleVaultDownloadExportFileBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export type GmailAddLabelBody = ContractBodyInput<typeof gmailAddLabelContract>
export type GmailArchiveBody = ContractBodyInput<typeof gmailArchiveContract>
export type GmailDeleteBody = ContractBodyInput<typeof gmailDeleteContract>
export type GmailDraftBody = ContractBodyInput<typeof gmailDraftContract>
export type GmailEditDraftBody = ContractBodyInput<typeof gmailEditDraftContract>
export type GmailMarkReadBody = ContractBodyInput<typeof gmailMarkReadContract>
export type GmailMarkUnreadBody = ContractBodyInput<typeof gmailMarkUnreadContract>
export type GmailMoveBody = ContractBodyInput<typeof gmailMoveContract>
export type GmailRemoveLabelBody = ContractBodyInput<typeof gmailRemoveLabelContract>
export type GmailSendBody = ContractBodyInput<typeof gmailSendContract>
export type GmailUnarchiveBody = ContractBodyInput<typeof gmailUnarchiveContract>
export type GoogleDriveUploadBody = ContractBodyInput<typeof googleDriveUploadContract>
export type GoogleDriveDownloadBody = ContractBodyInput<typeof googleDriveDownloadContract>
export type GoogleVaultDownloadExportFileBody = ContractBodyInput<
  typeof googleVaultDownloadExportFileContract
>

export type GmailAddLabelResponse = ContractJsonResponse<typeof gmailAddLabelContract>
export type GmailArchiveResponse = ContractJsonResponse<typeof gmailArchiveContract>
export type GmailDeleteResponse = ContractJsonResponse<typeof gmailDeleteContract>
export type GmailDraftResponse = ContractJsonResponse<typeof gmailDraftContract>
export type GmailEditDraftResponse = ContractJsonResponse<typeof gmailEditDraftContract>
export type GmailMarkReadResponse = ContractJsonResponse<typeof gmailMarkReadContract>
export type GmailMarkUnreadResponse = ContractJsonResponse<typeof gmailMarkUnreadContract>
export type GmailMoveResponse = ContractJsonResponse<typeof gmailMoveContract>
export type GmailRemoveLabelResponse = ContractJsonResponse<typeof gmailRemoveLabelContract>
export type GmailSendResponse = ContractJsonResponse<typeof gmailSendContract>
export type GmailUnarchiveResponse = ContractJsonResponse<typeof gmailUnarchiveContract>
export type GoogleDriveUploadResponse = ContractJsonResponse<typeof googleDriveUploadContract>
export type GoogleDriveDownloadResponse = ContractJsonResponse<typeof googleDriveDownloadContract>
export type GoogleVaultDownloadExportFileResponse = ContractJsonResponse<
  typeof googleVaultDownloadExportFileContract
>
