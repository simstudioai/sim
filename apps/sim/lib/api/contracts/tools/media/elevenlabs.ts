import { z } from 'zod'
import { userFileSchema } from '@/lib/api/contracts/primitives'
import { toolBooleanSchema, toolJsonResponseSchema } from '@/lib/api/contracts/tools/media/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'

const MISSING_FIELDS_ERROR = 'Missing required fields: operation and apiKey'

export const elevenLabsAudioFileSchema = userFileSchema.extend({
  type: z.string().optional().default(''),
})

export const elevenLabsAudioToolBodySchema = z
  .object({
    operation: z.enum(['sound_effects', 'speech_to_speech', 'audio_isolation'], {
      error: MISSING_FIELDS_ERROR,
    }),
    apiKey: z.string({ error: MISSING_FIELDS_ERROR }).min(1, MISSING_FIELDS_ERROR),
    voiceId: z.string().optional(),
    text: z.string().optional(),
    modelId: z.string().optional(),
    durationSeconds: z.coerce.number().min(0.5).max(30).optional(),
    promptInfluence: z.coerce.number().min(0).max(1).optional(),
    loop: toolBooleanSchema.optional(),
    removeBackgroundNoise: toolBooleanSchema.optional(),
    audioFile: elevenLabsAudioFileSchema.optional(),
    workspaceId: z.string().optional(),
    workflowId: z.string().optional(),
    executionId: z.string().optional(),
  })
  .passthrough()

export const elevenLabsAudioToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/elevenlabs/audio',
  body: elevenLabsAudioToolBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})
