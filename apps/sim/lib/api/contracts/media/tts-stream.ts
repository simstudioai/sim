import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const ttsStreamBodySchema = z
  .object({
    text: z.string().min(1),
    voiceId: z.string().min(1),
    modelId: z.string().optional().default('eleven_turbo_v2_5'),
    chatId: z.string().min(1),
  })
  .passthrough()

export const ttsStreamContract = defineRouteContract({
  method: 'POST',
  path: '/api/proxy/tts/stream',
  body: ttsStreamBodySchema,
  response: { mode: 'stream' },
})
