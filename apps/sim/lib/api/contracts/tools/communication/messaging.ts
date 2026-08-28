import { z } from 'zod'

export const smsSendBodySchema = z.object({
  to: z.string().min(1, 'To phone number is required'),
  body: z.string().min(1, 'SMS body is required'),
})
