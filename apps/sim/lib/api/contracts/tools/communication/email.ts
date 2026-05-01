import { z } from 'zod'
import { defineCommunicationToolContract } from '@/lib/api/contracts/tools/communication/shared'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'

export const smtpSendBodySchema = z.object({
  smtpHost: z.string().min(1, 'SMTP host is required'),
  smtpPort: z.number().min(1).max(65535, 'Port must be between 1 and 65535'),
  smtpUsername: z.string().min(1, 'SMTP username is required'),
  smtpPassword: z.string().min(1, 'SMTP password is required'),
  smtpSecure: z.enum(['TLS', 'SSL', 'None']),
  from: z.string().email('Invalid from email address').min(1, 'From address is required'),
  to: z.string().min(1, 'To email is required'),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Email body is required'),
  contentType: z.enum(['text', 'html']).optional().nullable(),
  fromName: z.string().optional().nullable(),
  cc: z.string().optional().nullable(),
  bcc: z.string().optional().nullable(),
  replyTo: z.string().optional().nullable(),
  attachments: RawFileInputArraySchema.optional().nullable(),
})

export const sendGridSendMailBodySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  from: z.string().min(1, 'From email is required'),
  fromName: z.string().optional().nullable(),
  to: z.string().min(1, 'To email is required'),
  toName: z.string().optional().nullable(),
  subject: z.string().optional().nullable(),
  content: z.string().optional().nullable(),
  contentType: z.string().optional().nullable(),
  cc: z.string().optional().nullable(),
  bcc: z.string().optional().nullable(),
  replyTo: z.string().optional().nullable(),
  replyToName: z.string().optional().nullable(),
  templateId: z.string().optional().nullable(),
  dynamicTemplateData: z.unknown().optional().nullable(),
  attachments: RawFileInputArraySchema.optional().nullable(),
})

export const smtpSendContract = defineCommunicationToolContract(
  '/api/tools/smtp/send',
  smtpSendBodySchema
)
export const sendGridSendMailContract = defineCommunicationToolContract(
  '/api/tools/sendgrid/send-mail',
  sendGridSendMailBodySchema
)

export type SmtpSendBody = ContractBodyInput<typeof smtpSendContract>
export type SendGridSendMailBody = ContractBodyInput<typeof sendGridSendMailContract>

export type SmtpSendResponse = ContractJsonResponse<typeof smtpSendContract>
export type SendGridSendMailResponse = ContractJsonResponse<typeof sendGridSendMailContract>
