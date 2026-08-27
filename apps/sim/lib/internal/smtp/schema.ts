import { z } from 'zod'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'

export const smtpSendInputSchema = z.object({
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

export type SmtpSendInput = z.output<typeof smtpSendInputSchema>
