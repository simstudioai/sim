import { z } from 'zod'
import { accessTokenSchema, messageIdSchema } from '@/lib/api/contracts/tools/microsoft'

export const outlookGetAttachmentInputSchema = z.object({
  accessToken: accessTokenSchema,
  messageId: messageIdSchema.trim().min(1, 'Message ID is required'),
  attachmentId: z.string().trim().min(1, 'Attachment ID is required'),
})

export type OutlookGetAttachmentInput = z.infer<typeof outlookGetAttachmentInputSchema>
