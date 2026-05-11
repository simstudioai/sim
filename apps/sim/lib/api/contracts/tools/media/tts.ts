import { z } from 'zod'
import { toolJsonResponseSchema } from '@/lib/api/contracts/tools/media/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const ttsToolBodySchema = z.object({
  text: z.string({ error: 'Missing required parameters' }).min(1, 'Missing required parameters'),
  voiceId: z.string({ error: 'Missing required parameters' }).min(1, 'Missing required parameters'),
  apiKey: z.string({ error: 'Missing required parameters' }).min(1, 'Missing required parameters'),
  modelId: z.string().optional().default('eleven_monolingual_v1'),
  workspaceId: z.string().optional(),
  workflowId: z.string().optional(),
  executionId: z.string().optional(),
})

export const ttsOutputFormatSchema = z.union([z.record(z.string(), z.unknown()), z.string()])
export const playHtOutputFormatSchema = z.enum(['mp3', 'wav', 'ogg', 'flac', 'mulaw'])

export const ttsUnifiedToolBodySchema = z
  .object({
    provider: z.enum(
      ['openai', 'deepgram', 'elevenlabs', 'cartesia', 'google', 'azure', 'playht'],
      {
        error: 'Missing required fields: provider, text, and apiKey',
      }
    ),
    text: z
      .string({ error: 'Missing required fields: provider, text, and apiKey' })
      .min(1, 'Missing required fields: provider, text, and apiKey'),
    apiKey: z
      .string({ error: 'Missing required fields: provider, text, and apiKey' })
      .min(1, 'Missing required fields: provider, text, and apiKey'),
    model: z.enum(['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts']).optional(),
    voice: z.string().optional(),
    responseFormat: z.enum(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm']).optional(),
    speed: z.coerce.number().optional(),
    encoding: z.enum(['linear16', 'mp3', 'opus', 'aac', 'flac', 'mulaw', 'alaw']).optional(),
    sampleRate: z.coerce.number().optional(),
    bitRate: z.coerce.number().optional(),
    container: z.enum(['none', 'wav', 'ogg']).optional(),
    voiceId: z.string().optional(),
    modelId: z.string().optional(),
    stability: z.coerce.number().optional(),
    similarityBoost: z.coerce.number().optional(),
    style: z.union([z.coerce.number(), z.string()]).optional(),
    useSpeakerBoost: z.boolean().optional(),
    language: z.string().optional(),
    outputFormat: ttsOutputFormatSchema.optional().nullable(),
    emotion: z.array(z.string()).optional(),
    languageCode: z.string().optional(),
    gender: z.enum(['MALE', 'FEMALE', 'NEUTRAL']).optional(),
    audioEncoding: z.enum(['LINEAR16', 'MP3', 'OGG_OPUS', 'MULAW', 'ALAW']).optional(),
    speakingRate: z.coerce.number().optional(),
    pitch: z.union([z.number(), z.string()]).optional(),
    volumeGainDb: z.coerce.number().optional(),
    sampleRateHertz: z.coerce.number().optional(),
    effectsProfileId: z.array(z.string()).optional(),
    region: z
      .string()
      .regex(
        /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/,
        'region must be a valid Azure region identifier (e.g. eastus, westeurope)'
      )
      .optional(),
    rate: z.string().optional(),
    styleDegree: z.coerce.number().optional(),
    role: z.string().optional(),
    userId: z.string().optional(),
    quality: z.enum(['draft', 'standard', 'premium']).optional(),
    temperature: z.coerce.number().optional(),
    voiceGuidance: z.coerce.number().optional(),
    textGuidance: z.coerce.number().optional(),
    workspaceId: z.string().optional(),
    workflowId: z.string().optional(),
    executionId: z.string().optional(),
  })
  .passthrough()

export const ttsToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/tts',
  body: ttsToolBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const ttsUnifiedToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/tts/unified',
  body: ttsUnifiedToolBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})
