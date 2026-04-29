import { z } from 'zod'
import type { ContractBody } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { RawFileInputArraySchema, RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

const excelCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const excelRowSchema = z.array(excelCellSchema)
const excelValuesSchema = z.union([
  z.string(),
  z.array(excelRowSchema),
  z.array(z.record(z.string(), excelCellSchema)),
])

export const accessTokenSchema = z.string().min(1, 'Access token is required')
export const messageIdSchema = z.string().min(1, 'Message ID is required')
export const destinationIdSchema = z.string().min(1, 'Destination folder ID is required')

export const outlookSendBodySchema = z.object({
  accessToken: accessTokenSchema,
  to: z.string().min(1, 'Recipient email is required'),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Email body is required'),
  contentType: z.enum(['text', 'html']).optional().nullable(),
  cc: z.string().optional().nullable(),
  bcc: z.string().optional().nullable(),
  replyToMessageId: z.string().optional().nullable(),
  attachments: RawFileInputArraySchema.optional().nullable(),
})

export const outlookDraftBodySchema = outlookSendBodySchema.omit({
  replyToMessageId: true,
})

export const outlookDeleteBodySchema = z.object({
  accessToken: accessTokenSchema,
  messageId: messageIdSchema,
})

export const outlookCopyMoveBodySchema = outlookDeleteBodySchema.extend({
  destinationId: destinationIdSchema,
})

export const teamsWriteChannelBodySchema = z.object({
  accessToken: accessTokenSchema,
  teamId: z.string().min(1, 'Team ID is required'),
  channelId: z.string().min(1, 'Channel ID is required'),
  content: z.string().min(1, 'Message content is required'),
  files: RawFileInputArraySchema.optional().nullable(),
})

export const teamsWriteChatBodySchema = z.object({
  accessToken: accessTokenSchema,
  chatId: z.string().min(1, 'Chat ID is required'),
  content: z.string().min(1, 'Message content is required'),
  files: RawFileInputArraySchema.optional().nullable(),
})

export const teamsDeleteChatMessageBodySchema = z.object({
  accessToken: accessTokenSchema,
  chatId: z.string().min(1, 'Chat ID is required'),
  messageId: messageIdSchema,
})

export const onedriveUploadBodySchema = z.object({
  accessToken: accessTokenSchema,
  fileName: z.string().min(1, 'File name is required'),
  file: RawFileInputSchema.optional(),
  folderId: z.string().optional().nullable(),
  mimeType: z.string().nullish(),
  values: excelValuesSchema.optional().nullable(),
  conflictBehavior: z.enum(['fail', 'replace', 'rename']).optional().nullable(),
})

export const onedriveDownloadBodySchema = z.object({
  accessToken: accessTokenSchema,
  fileId: z.string().min(1, 'File ID is required'),
  fileName: z.string().optional().nullable(),
})

export const sharepointUploadBodySchema = z.object({
  accessToken: accessTokenSchema,
  siteId: z.string().default('root'),
  driveId: z.string().optional().nullable(),
  folderPath: z.string().optional().nullable(),
  fileName: z.string().optional().nullable(),
  files: RawFileInputArraySchema.optional().nullable(),
})

export const dataverseUploadFileBodySchema = z.object({
  accessToken: accessTokenSchema,
  environmentUrl: z.string().min(1, 'Environment URL is required'),
  entitySetName: z.string().min(1, 'Entity set name is required'),
  recordId: z.string().min(1, 'Record ID is required'),
  fileColumn: z.string().min(1, 'File column is required'),
  fileName: z.string().min(1, 'File name is required'),
  file: RawFileInputSchema.optional().nullable(),
  fileContent: z.string().optional().nullable(),
})

const toolJsonResponseSchema = z.unknown()

export const outlookSendContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/outlook/send',
  body: outlookSendBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const outlookDraftContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/outlook/draft',
  body: outlookDraftBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const outlookDeleteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/outlook/delete',
  body: outlookDeleteBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const outlookCopyContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/outlook/copy',
  body: outlookCopyMoveBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const outlookMoveContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/outlook/move',
  body: outlookCopyMoveBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const outlookMarkReadContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/outlook/mark-read',
  body: outlookDeleteBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const outlookMarkUnreadContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/outlook/mark-unread',
  body: outlookDeleteBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const teamsWriteChannelContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/microsoft_teams/write_channel',
  body: teamsWriteChannelBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const teamsWriteChatContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/microsoft_teams/write_chat',
  body: teamsWriteChatBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const teamsDeleteChatMessageContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/microsoft_teams/delete_chat_message',
  body: teamsDeleteChatMessageBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const onedriveUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/onedrive/upload',
  body: onedriveUploadBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const onedriveDownloadContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/onedrive/download',
  body: onedriveDownloadBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const sharepointUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sharepoint/upload',
  body: sharepointUploadBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const dataverseUploadFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/microsoft-dataverse/upload-file',
  body: dataverseUploadFileBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export type OutlookSendBody = ContractBody<typeof outlookSendContract>
export type OutlookDraftBody = ContractBody<typeof outlookDraftContract>
export type OutlookDeleteBody = ContractBody<typeof outlookDeleteContract>
export type OutlookCopyBody = ContractBody<typeof outlookCopyContract>
export type OutlookMoveBody = ContractBody<typeof outlookMoveContract>
export type OutlookMarkReadBody = ContractBody<typeof outlookMarkReadContract>
export type OutlookMarkUnreadBody = ContractBody<typeof outlookMarkUnreadContract>
export type TeamsWriteChannelBody = ContractBody<typeof teamsWriteChannelContract>
export type TeamsWriteChatBody = ContractBody<typeof teamsWriteChatContract>
export type TeamsDeleteChatMessageBody = ContractBody<typeof teamsDeleteChatMessageContract>
export type OneDriveUploadBody = ContractBody<typeof onedriveUploadContract>
export type OneDriveDownloadBody = ContractBody<typeof onedriveDownloadContract>
export type SharepointUploadBody = ContractBody<typeof sharepointUploadContract>
export type DataverseUploadFileBody = z.output<typeof dataverseUploadFileBodySchema>
