import { z } from 'zod'
import { mediaUserFileSchema, toolJsonResponseSchema } from '@/lib/api/contracts/tools/media/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const sttProviders = ['whisper', 'deepgram', 'elevenlabs', 'assemblyai', 'gemini'] as const
const MISSING_STT_FIELDS_ERROR = 'Missing required fields: provider and apiKey'

export const sttUserFileSchema = mediaUserFileSchema.extend({
  type: z.string().optional().default(''),
})

export const sttUserFileInputSchema = z.union([sttUserFileSchema, z.array(sttUserFileSchema)])

export const sttToolBodySchema = z
  .object({
    provider: z
      .string({ error: MISSING_STT_FIELDS_ERROR })
      .min(1, MISSING_STT_FIELDS_ERROR)
      .refine((provider) => sttProviders.includes(provider as (typeof sttProviders)[number]), {
        message: `Invalid provider. Must be one of: ${sttProviders.join(', ')}`,
      }),
    apiKey: z.string({ error: MISSING_STT_FIELDS_ERROR }).min(1, MISSING_STT_FIELDS_ERROR),
    model: z.string().optional(),
    audioFile: sttUserFileInputSchema.optional(),
    audioFileReference: sttUserFileInputSchema.optional(),
    audioUrl: z.string().optional(),
    language: z.string().optional(),
    timestamps: z.enum(['none', 'sentence', 'word']).optional(),
    diarization: z.boolean().optional(),
    translateToEnglish: z.boolean().optional(),
    prompt: z.string().optional(),
    temperature: z.coerce.number().optional(),
    sentiment: z.boolean().optional(),
    entityDetection: z.boolean().optional(),
    piiRedaction: z.boolean().optional(),
    summarization: z.boolean().optional(),
    workspaceId: z.string().optional(),
    workflowId: z.string().optional(),
    executionId: z.string().optional(),
  })
  .passthrough()

export const sttToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/stt',
  body: sttToolBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})
