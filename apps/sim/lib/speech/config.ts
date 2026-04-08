import { env } from '@/lib/core/config/env'

export const ELEVENLABS_WS_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime'
export const SAMPLE_RATE = 16000
export const CHUNK_SEND_INTERVAL_MS = 250
export const MAX_SESSION_MS = 3 * 60 * 1000
export const MAX_CHAT_SESSION_MS = 1 * 60 * 1000

/**
 * Whether a speech-to-text provider is configured.
 * Currently checks for `ELEVENLABS_API_KEY`.
 * To add a new provider: add its env check here.
 */
export function hasSTTService(): boolean {
  return !!env.ELEVENLABS_API_KEY?.trim()
}
