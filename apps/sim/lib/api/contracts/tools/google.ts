import { z } from 'zod'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { RawFileInputArraySchema, RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

const googleAccessTokenSchema = z.string().min(1, 'Access token is required')
const gmailMessageIdSchema = z.string().min(1, 'Message ID is required')

const gmailMessageBodySchema = z.object({
  accessToken: googleAccessTokenSchema,
  messageId: gmailMessageIdSchema,
})

const gmailLabelBodySchema = gmailMessageBodySchema.extend({
  labelIds: z.string().min(1, 'At least one label ID is required'),
})

const gmailMoveBodySchema = gmailMessageBodySchema.extend({
  addLabelIds: z.string().min(1, 'At least one label to add is required'),
  removeLabelIds: z.string().optional().nullable(),
})

const gmailMailBodySchema = z.object({
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

const gmailEditDraftBodySchema = gmailMailBodySchema.extend({
  draftId: z.string().min(1, 'Draft ID is required'),
})

const googleDriveUploadBodySchema = z.object({
  accessToken: googleAccessTokenSchema,
  fileName: z.string().min(1, 'File name is required'),
  file: RawFileInputSchema.optional().nullable(),
  mimeType: z.string().optional().nullable(),
  folderId: z.string().optional().nullable(),
})

const googleDriveDownloadBodySchema = z.object({
  accessToken: googleAccessTokenSchema,
  fileId: z.string().min(1, 'File ID is required'),
  mimeType: z.string().optional().nullable(),
  fileName: z.string().optional().nullable(),
  includeRevisions: z.boolean().optional().default(true),
})

const googleVaultDownloadExportFileBodySchema = z.object({
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

type GmailAddLabelBody = ContractBodyInput<typeof gmailAddLabelContract>
type GmailArchiveBody = ContractBodyInput<typeof gmailArchiveContract>
type GmailDeleteBody = ContractBodyInput<typeof gmailDeleteContract>
type GmailDraftBody = ContractBodyInput<typeof gmailDraftContract>
type GmailEditDraftBody = ContractBodyInput<typeof gmailEditDraftContract>
type GmailMarkReadBody = ContractBodyInput<typeof gmailMarkReadContract>
type GmailMarkUnreadBody = ContractBodyInput<typeof gmailMarkUnreadContract>
type GmailMoveBody = ContractBodyInput<typeof gmailMoveContract>
type GmailRemoveLabelBody = ContractBodyInput<typeof gmailRemoveLabelContract>
type GmailSendBody = ContractBodyInput<typeof gmailSendContract>
type GmailUnarchiveBody = ContractBodyInput<typeof gmailUnarchiveContract>
type GoogleDriveUploadBody = ContractBodyInput<typeof googleDriveUploadContract>
type GoogleDriveDownloadBody = ContractBodyInput<typeof googleDriveDownloadContract>
type GoogleVaultDownloadExportFileBody = ContractBodyInput<
  typeof googleVaultDownloadExportFileContract
>

type GmailAddLabelResponse = ContractJsonResponse<typeof gmailAddLabelContract>
type GmailArchiveResponse = ContractJsonResponse<typeof gmailArchiveContract>
type GmailDeleteResponse = ContractJsonResponse<typeof gmailDeleteContract>
type GmailDraftResponse = ContractJsonResponse<typeof gmailDraftContract>
type GmailEditDraftResponse = ContractJsonResponse<typeof gmailEditDraftContract>
type GmailMarkReadResponse = ContractJsonResponse<typeof gmailMarkReadContract>
type GmailMarkUnreadResponse = ContractJsonResponse<typeof gmailMarkUnreadContract>
type GmailMoveResponse = ContractJsonResponse<typeof gmailMoveContract>
type GmailRemoveLabelResponse = ContractJsonResponse<typeof gmailRemoveLabelContract>
type GmailSendResponse = ContractJsonResponse<typeof gmailSendContract>
type GmailUnarchiveResponse = ContractJsonResponse<typeof gmailUnarchiveContract>
type GoogleDriveUploadResponse = ContractJsonResponse<typeof googleDriveUploadContract>
type GoogleDriveDownloadResponse = ContractJsonResponse<typeof googleDriveDownloadContract>
type GoogleVaultDownloadExportFileResponse = ContractJsonResponse<
  typeof googleVaultDownloadExportFileContract
>
