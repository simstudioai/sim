import {
  createTimeoutAbortController,
  DEFAULT_EXECUTION_TIMEOUT_MS,
} from '@/lib/core/execution-limits'
import { consumeOrCancelBody, readResponseToBufferWithLimit } from '@/lib/core/utils/stream-limits'
import { ElevenLabsOperationError } from '@/lib/internal/elevenlabs/errors'
import type {
  ElevenLabsAudioIsolationInput,
  ElevenLabsSoundEffectsInput,
  ElevenLabsSpeechToSpeechInput,
} from '@/lib/internal/elevenlabs/schema'

const BASE_URL = 'https://api.elevenlabs.io/v1'
export const MAX_ELEVENLABS_AUDIO_BYTES = 25 * 1024 * 1024

export interface ElevenLabsSourceAudio {
  buffer: Buffer
  fileName: string
  mimeType: string
}

type GenerateElevenLabsAudioArgs =
  | { operation: 'sound_effects'; input: ElevenLabsSoundEffectsInput; source?: never }
  | {
      operation: 'speech_to_speech'
      input: ElevenLabsSpeechToSpeechInput
      source: ElevenLabsSourceAudio
    }
  | {
      operation: 'audio_isolation'
      input: ElevenLabsAudioIsolationInput
      source: ElevenLabsSourceAudio
    }

function buildRequest(args: GenerateElevenLabsAudioArgs): { url: string; init: RequestInit } {
  const headers: Record<string, string> = {
    'xi-api-key': args.input.apiKey,
    Accept: 'audio/mpeg',
  }

  if (args.operation === 'sound_effects') {
    const body: Record<string, unknown> = { text: args.input.text }
    if (args.input.modelId) body.model_id = args.input.modelId
    if (args.input.durationSeconds !== undefined) {
      body.duration_seconds = args.input.durationSeconds
    }
    if (args.input.promptInfluence !== undefined) {
      body.prompt_influence = args.input.promptInfluence
    }
    if (args.input.loop !== undefined) body.loop = args.input.loop
    return {
      url: `${BASE_URL}/sound-generation`,
      init: {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    }
  }

  const formData = new FormData()
  formData.append(
    'audio',
    new Blob([new Uint8Array(args.source.buffer)], { type: args.source.mimeType }),
    args.source.fileName
  )

  if (args.operation === 'speech_to_speech') {
    if (args.input.modelId) formData.append('model_id', args.input.modelId)
    if (args.input.removeBackgroundNoise !== undefined) {
      formData.append('remove_background_noise', String(args.input.removeBackgroundNoise))
    }
    return {
      url: `${BASE_URL}/speech-to-speech/${args.input.voiceId}`,
      init: { method: 'POST', headers, body: formData },
    }
  }

  return {
    url: `${BASE_URL}/audio-isolation`,
    init: { method: 'POST', headers, body: formData },
  }
}

export async function generateElevenLabsAudio(
  args: GenerateElevenLabsAudioArgs,
  signal?: AbortSignal
): Promise<Buffer> {
  signal?.throwIfAborted()
  const timeout = createTimeoutAbortController(DEFAULT_EXECUTION_TIMEOUT_MS, signal)
  try {
    const { url, init } = buildRequest(args)
    const response = await fetch(url, { ...init, signal: timeout.signal })
    timeout.signal.throwIfAborted()
    if (!response.ok) {
      await consumeOrCancelBody(response)
      timeout.signal.throwIfAborted()
      throw new ElevenLabsOperationError(
        `ElevenLabs request failed: ${response.status} ${response.statusText}`,
        response.status
      )
    }

    const buffer = await readResponseToBufferWithLimit(response, {
      maxBytes: MAX_ELEVENLABS_AUDIO_BYTES,
      label: `ElevenLabs ${args.operation} response`,
      signal: timeout.signal,
    })
    if (buffer.length === 0) throw new ElevenLabsOperationError('Empty audio received', 422)
    return buffer
  } finally {
    timeout.cleanup()
  }
}
