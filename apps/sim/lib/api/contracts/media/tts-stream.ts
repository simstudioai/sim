import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

/** Default ElevenLabs voice (Jessica) — Flash v2.5-optimized. */
export const DEFAULT_TTS_VOICE_ID = 'cgSgspJ2msm6clMCkdW9'

export const DEFAULT_TTS_MODEL_ID = 'eleven_flash_v2_5'

/**
 * Voices and models the deployed-chat relay may spend the platform ElevenLabs
 * key on. Anonymous visitors of a public chat can reach the relay, so these are
 * allowlists rather than free-form strings — otherwise the caller chooses the
 * (possibly premium or cloned) voice and the billing model.
 */
const ALLOWED_TTS_VOICE_IDS = [DEFAULT_TTS_VOICE_ID] as const
const ALLOWED_TTS_MODEL_IDS = [DEFAULT_TTS_MODEL_ID] as const

/**
 * ElevenLabs bills per character, so an uncapped `text` is an uncapped charge.
 * Chat TTS synthesizes the streamed answer sentence by sentence, keeping real
 * requests far below this ceiling.
 */
export const MAX_TTS_TEXT_LENGTH = 2000

export const ttsStreamBodySchema = z.object({
  text: z.string().min(1).max(MAX_TTS_TEXT_LENGTH),
  voiceId: z.enum(ALLOWED_TTS_VOICE_IDS),
  modelId: z.enum(ALLOWED_TTS_MODEL_IDS).optional().default(DEFAULT_TTS_MODEL_ID),
  chatId: z.string().min(1),
})

export const ttsStreamContract = defineRouteContract({
  method: 'POST',
  path: '/api/proxy/tts/stream',
  body: ttsStreamBodySchema,
  response: { mode: 'stream' },
})
