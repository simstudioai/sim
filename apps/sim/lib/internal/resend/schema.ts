import { z } from 'zod'

export const resendSendInputSchema = z.object({
  fromAddress: z.string().min(1, 'From address is required'),
  to: z.string().min(1, 'To email is required'),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Email body is required'),
  contentType: z.enum(['text', 'html']).optional().nullable(),
  resendApiKey: z.string().min(1, 'Resend API key is required'),
  cc: z
    .union([z.string().min(1), z.array(z.string().min(1))])
    .optional()
    .nullable(),
  bcc: z
    .union([z.string().min(1), z.array(z.string().min(1))])
    .optional()
    .nullable(),
  replyTo: z
    .union([z.string().min(1), z.array(z.string().min(1))])
    .optional()
    .nullable(),
  scheduledAt: z.string().datetime().optional().nullable(),
  tags: z.string().optional().nullable(),
})

export type ResendSendInput = z.output<typeof resendSendInputSchema>
