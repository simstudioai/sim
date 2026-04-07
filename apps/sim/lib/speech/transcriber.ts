import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import { ElevenLabsSTTProvider } from '@/lib/speech/providers/elevenlabs'
import type { STTProvider, TranscribeOptions, TranscribeResult } from '@/lib/speech/types'

const logger = createLogger('Transcriber')

function resolveProvider(): STTProvider | null {
  const elevenLabsKey = env.ELEVENLABS_API_KEY
  if (elevenLabsKey?.trim()) {
    return new ElevenLabsSTTProvider(elevenLabsKey)
  }

  return null
}

/**
 * Whether at least one STT provider is configured.
 * Use this to conditionally show or hide voice input UI.
 */
export function hasSTTService(): boolean {
  return resolveProvider() !== null
}

/**
 * Transcribe an audio buffer using the configured STT provider.
 * Throws if no provider is available or transcription fails.
 */
export async function transcribe(
  audio: Buffer,
  mimeType: string,
  options?: TranscribeOptions
): Promise<TranscribeResult> {
  const provider = resolveProvider()
  if (!provider) {
    throw new Error('No STT provider configured. Set ELEVENLABS_API_KEY in environment.')
  }

  logger.info('Transcribing audio', {
    provider: provider.name,
    mimeType,
    sizeBytes: audio.length,
  })

  const result = await provider.transcribe(audio, mimeType, options)

  logger.info('Transcription complete', {
    provider: provider.name,
    textLength: result.text.length,
    language: result.language,
  })

  return result
}
