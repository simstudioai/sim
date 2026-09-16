import { z } from 'zod'
import { resourceOwnerSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const speechTokenBodySchema = resourceOwnerSchema
export type SpeechTokenBody = z.input<typeof speechTokenBodySchema>

export const speechTokenResponseSchema = z.object({
  token: z.string(),
})
export type SpeechTokenResponse = z.output<typeof speechTokenResponseSchema>

export const speechTokenContract = defineRouteContract({
  method: 'POST',
  path: '/api/speech/token',
  body: speechTokenBodySchema,
  response: { mode: 'json', schema: speechTokenResponseSchema },
})
