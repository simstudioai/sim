import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const speechTokenBodySchema = z
  .object({
    chatId: z.string().optional(),
  })
  .passthrough()

export const speechTokenResponseSchema = z.object({
  token: z.string(),
})

export const speechTokenContract = defineRouteContract({
  method: 'POST',
  path: '/api/speech/token',
  body: speechTokenBodySchema,
  response: { mode: 'json', schema: speechTokenResponseSchema },
})
