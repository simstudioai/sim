import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const mailSendResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z
    .object({
      id: z.string(),
    })
    .nullable(),
})

export const mailSendBodySchema = z.object({
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

export const mailSendContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/mail/send',
  body: mailSendBodySchema,
  response: { mode: 'json', schema: mailSendResponseSchema },
})

export type MailSendBody = ContractBody<typeof mailSendContract>
export type MailSendBodyInput = ContractBodyInput<typeof mailSendContract>
export type MailSendResponse = ContractJsonResponse<typeof mailSendContract>
