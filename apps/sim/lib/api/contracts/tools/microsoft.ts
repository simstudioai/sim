import { z } from 'zod'
import type { ContractBody } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'

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

export type OutlookSendBody = ContractBody<typeof outlookSendContract>
export type OutlookDraftBody = ContractBody<typeof outlookDraftContract>
export type OutlookDeleteBody = ContractBody<typeof outlookDeleteContract>
export type OutlookCopyBody = ContractBody<typeof outlookCopyContract>
export type OutlookMoveBody = ContractBody<typeof outlookMoveContract>
export type OutlookMarkReadBody = ContractBody<typeof outlookMarkReadContract>
export type OutlookMarkUnreadBody = ContractBody<typeof outlookMarkUnreadContract>
