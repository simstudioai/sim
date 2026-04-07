import { createLogger } from '@sim/logger'
import type { STTProvider, TranscribeOptions, TranscribeResult } from '@/lib/speech/types'

const logger = createLogger('ElevenLabsSTT')

const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text'
const DEFAULT_MODEL = 'scribe_v2'

export class ElevenLabsSTTProvider implements STTProvider {
  readonly name = 'elevenlabs'
  private readonly apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async transcribe(
    audio: Buffer,
    mimeType: string,
    options?: TranscribeOptions
  ): Promise<TranscribeResult> {
    const formData = new FormData()
    const blob = new Blob([new Uint8Array(audio)], { type: mimeType })

    const subtype = (mimeType.split('/')[1] ?? 'webm').split(';')[0]
    formData.append('file', blob, `recording.${subtype}`)
    formData.append('model_id', DEFAULT_MODEL)

    if (options?.language && options.language !== 'auto') {
      formData.append('language_code', options.language)
    }

    const response = await fetch(ELEVENLABS_STT_URL, {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey },
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      let message: string
      if (typeof error.detail === 'string') {
        message = error.detail
      } else if (Array.isArray(error.detail)) {
        message = error.detail.map((d: { msg?: string }) => d.msg ?? JSON.stringify(d)).join('; ')
      } else {
        message = error.detail?.message || error.message || JSON.stringify(error)
      }
      logger.error('ElevenLabs STT request failed', { status: response.status, message })
      throw new Error(`ElevenLabs STT error: ${message}`)
    }

    const data = await response.json()

    return {
      text: data.text || '',
      language: data.language_code,
    }
  }
}
