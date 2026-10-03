import { z } from 'zod'
import { resolvedSecretTraceProvenanceSchema, userFileSchema } from '@/lib/api/contracts/primitives'
import { toolBooleanSchema } from '@/lib/api/contracts/tools/media/shared'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'

const MISSING_FIELDS_ERROR = 'Missing required fields: operation and apiKey'

const apiKeySchema = z.string({ error: MISSING_FIELDS_ERROR }).min(1, MISSING_FIELDS_ERROR)

const audioFileSchema = userFileSchema.extend({
  type: z.string().optional().default(''),
})

const privateProvenance = {
  [RESOLVED_SECRET_PROVENANCE_FIELD]: resolvedSecretTraceProvenanceSchema.optional(),
}

export const elevenLabsSoundEffectsInputSchema = z
  .object({
    apiKey: apiKeySchema,
    text: z.string().optional(),
    modelId: z.string().optional(),
    durationSeconds: z.coerce.number().min(0.5).max(30).optional(),
    promptInfluence: z.coerce.number().min(0).max(1).optional(),
    loop: toolBooleanSchema.optional(),
    ...privateProvenance,
  })
  .passthrough()

export const elevenLabsSpeechToSpeechInputSchema = z
  .object({
    apiKey: apiKeySchema,
    voiceId: z.string().optional(),
    audioFile: audioFileSchema.optional(),
    modelId: z.string().optional(),
    removeBackgroundNoise: toolBooleanSchema.optional(),
    ...privateProvenance,
  })
  .passthrough()

export const elevenLabsAudioIsolationInputSchema = z
  .object({
    apiKey: apiKeySchema,
    audioFile: audioFileSchema.optional(),
    ...privateProvenance,
  })
  .passthrough()

export type ElevenLabsSoundEffectsInput = z.output<typeof elevenLabsSoundEffectsInputSchema>
export type ElevenLabsSpeechToSpeechInput = z.output<typeof elevenLabsSpeechToSpeechInputSchema>
export type ElevenLabsAudioIsolationInput = z.output<typeof elevenLabsAudioIsolationInputSchema>
