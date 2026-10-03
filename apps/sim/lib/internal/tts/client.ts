import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/core/execution-limits'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import {
  assertKnownSizeWithinLimit,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { TtsOperationError } from '@/lib/internal/tts/errors'
import { getTtsMimeType } from '@/lib/internal/tts/formats'
import type { ElevenLabsTtsParams } from '@/tools/elevenlabs/types'
import type {
  AzureTtsParams,
  CartesiaTtsParams,
  DeepgramTtsParams,
  ElevenLabsTtsUnifiedParams,
  GoogleTtsParams,
  OpenAiTtsParams,
  PlayHtTtsParams,
} from '@/tools/tts/types'

const logger = createLogger('TtsClient')
export const MAX_TTS_AUDIO_BYTES = 25 * 1024 * 1024
export const MAX_TTS_TEXT_BYTES = 10 * 1024 * 1024
const MAX_TTS_ERROR_BYTES = 64 * 1024
const MAX_TTS_JSON_BYTES = Math.ceil((MAX_TTS_AUDIO_BYTES * 4) / 3) + 256 * 1024

export interface TtsAudioResult {
  audioBuffer: Buffer
  format: string
  mimeType: string
  duration?: number
}

export type OpenAiTtsOperationInput = Omit<OpenAiTtsParams, 'voice'> & { voice?: string }
export type CartesiaTtsOperationInput = Omit<CartesiaTtsParams, 'outputFormat'> & {
  outputFormat?: Record<string, unknown> | string | null
}
export type AzureTtsOperationInput = Omit<AzureTtsParams, 'outputFormat' | 'pitch' | 'style'> & {
  outputFormat?: string
  pitch?: number | string
  style?: number | string
}

async function providerFetch(
  input: string,
  init: RequestInit,
  signal?: AbortSignal,
  timeoutMs?: number
): Promise<Response> {
  signal?.throwIfAborted()
  if (!timeoutMs) return fetch(input, { ...init, signal })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('TTS request timed out')), timeoutMs)
  const abort = () => controller.abort(signal?.reason ?? new Error('Request aborted'))
  signal?.addEventListener('abort', abort, { once: true })
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

async function readTtsErrorJson(
  response: Response,
  label: string,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  return readResponseJsonWithLimit<Record<string, unknown>>(response, {
    maxBytes: MAX_TTS_ERROR_BYTES,
    label,
    signal,
  }).catch(() => ({}))
}

function getTtsErrorMessage(error: Record<string, unknown>, fallback: string): string {
  const nested = error.error
  if (isRecordLike(nested) && typeof nested.message === 'string') return nested.message
  for (const key of ['message', 'err_msg', 'error_message', 'error', 'detail']) {
    const value = error[key]
    if (typeof value === 'string') return value
    if (isRecordLike(value) && typeof value.message === 'string') return value.message
  }
  return fallback
}

async function readAudio(response: Response, label: string, signal?: AbortSignal): Promise<Buffer> {
  return readResponseToBufferWithLimit(response, {
    maxBytes: MAX_TTS_AUDIO_BYTES,
    label,
    signal,
  })
}

function assertTextWithinLimit(text: string): void {
  assertKnownSizeWithinLimit(Buffer.byteLength(text), MAX_TTS_TEXT_BYTES, 'TTS text')
}

export async function synthesizeOpenAi(
  input: OpenAiTtsOperationInput,
  signal?: AbortSignal
): Promise<TtsAudioResult> {
  assertTextWithinLimit(input.text)
  const model = input.model || 'tts-1'
  const voice = input.voice || 'alloy'
  const format = input.responseFormat || 'mp3'
  const response = await providerFetch(
    'https://api.openai.com/v1/audio/speech',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        voice,
        input: input.text,
        response_format: format,
        speed: Math.max(0.25, Math.min(4, input.speed ?? 1)),
      }),
    },
    signal
  )
  if (!response.ok) {
    const error = await readTtsErrorJson(response, 'OpenAI TTS error response', signal)
    throw new Error(`OpenAI TTS API error: ${getTtsErrorMessage(error, response.statusText)}`)
  }
  return {
    audioBuffer: await readAudio(response, 'OpenAI TTS audio response', signal),
    format,
    mimeType: getTtsMimeType(format),
  }
}

export async function synthesizeDeepgram(
  input: DeepgramTtsParams,
  signal?: AbortSignal
): Promise<TtsAudioResult> {
  assertTextWithinLimit(input.text)
  const model = input.model || input.voice || 'aura-asteria-en'
  const encoding = input.encoding || 'mp3'
  const query = new URLSearchParams({ model, encoding })
  if (input.sampleRate && encoding === 'linear16') {
    query.append('sample_rate', input.sampleRate.toString())
  }
  if (input.bitRate) query.append('bit_rate', input.bitRate.toString())
  if (input.container && input.container !== 'none') query.append('container', input.container)
  const response = await providerFetch(
    `https://api.deepgram.com/v1/speak?${query}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: input.text }),
    },
    signal
  )
  if (!response.ok) {
    const error = await readTtsErrorJson(response, 'Deepgram TTS error response', signal)
    throw new Error(`Deepgram TTS API error: ${getTtsErrorMessage(error, response.statusText)}`)
  }
  const format = input.container === 'wav' || input.container === 'ogg' ? input.container : encoding
  return {
    audioBuffer: await readAudio(response, 'Deepgram TTS audio response', signal),
    format,
    mimeType: getTtsMimeType(format),
  }
}

export async function synthesizeElevenLabs(
  input: ElevenLabsTtsUnifiedParams,
  signal?: AbortSignal
): Promise<TtsAudioResult> {
  assertTextWithinLimit(input.text)
  const voiceIdValidation = validateAlphanumericId(input.voiceId, 'voiceId')
  if (!voiceIdValidation.isValid) {
    throw new TtsOperationError(voiceIdValidation.error || 'Invalid voiceId', 400)
  }
  const voiceSettings: Record<string, unknown> = {
    stability: Math.max(0, Math.min(1, input.stability ?? 0.5)),
    similarity_boost: Math.max(0, Math.min(1, input.similarityBoost ?? 0.8)),
    use_speaker_boost: input.useSpeakerBoost ?? true,
  }
  if (input.style !== undefined) {
    voiceSettings.style = Math.max(0, Math.min(1, input.style))
  }
  const response = await providerFetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${input.voiceId}`,
    {
      method: 'POST',
      headers: {
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': input.apiKey,
      },
      body: JSON.stringify({
        text: input.text,
        model_id: input.modelId || 'eleven_turbo_v2_5',
        voice_settings: voiceSettings,
      }),
    },
    signal
  )
  if (!response.ok) {
    const error = await readTtsErrorJson(response, 'ElevenLabs TTS error response', signal)
    throw new Error(`ElevenLabs TTS API error: ${getTtsErrorMessage(error, response.statusText)}`)
  }
  return {
    audioBuffer: await readAudio(response, 'ElevenLabs TTS audio response', signal),
    format: 'mp3',
    mimeType: 'audio/mpeg',
  }
}

export async function synthesizeLegacyElevenLabs(
  input: ElevenLabsTtsParams,
  signal?: AbortSignal
): Promise<TtsAudioResult> {
  assertTextWithinLimit(input.text)
  const voiceIdValidation = validateAlphanumericId(input.voiceId, 'voiceId', 255)
  if (!voiceIdValidation.isValid) {
    throw new TtsOperationError(voiceIdValidation.error || 'Invalid voiceId', 400)
  }
  const hasVoiceSetting = input.stability !== undefined || input.similarityBoost !== undefined
  const voiceSettings = hasVoiceSetting
    ? {
        stability: input.stability ?? 0.5,
        similarity_boost: input.similarityBoost ?? 0.75,
      }
    : undefined
  const response = await providerFetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${input.voiceId}`,
    {
      method: 'POST',
      headers: {
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': input.apiKey,
      },
      body: JSON.stringify({
        text: input.text,
        model_id: input.modelId || 'eleven_monolingual_v1',
        ...(voiceSettings ? { voice_settings: voiceSettings } : {}),
      }),
    },
    signal,
    DEFAULT_EXECUTION_TIMEOUT_MS
  )
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new TtsOperationError(
      `Failed to generate TTS: ${response.status} ${response.statusText}`,
      response.status
    )
  }
  const audioBuffer = await readAudio(response, 'TTS audio response', signal)
  if (audioBuffer.length === 0) throw new TtsOperationError('Empty audio received', 422)
  return { audioBuffer, format: 'mp3', mimeType: 'audio/mpeg' }
}

export async function synthesizeCartesia(
  input: CartesiaTtsOperationInput,
  signal?: AbortSignal
): Promise<TtsAudioResult> {
  assertTextWithinLimit(input.text)
  const requestBody: Record<string, unknown> = {
    model_id: input.modelId || 'sonic-3',
    transcript: input.text,
    language: input.language || 'en',
  }
  if (input.voice) requestBody.voice = { mode: 'id', id: input.voice }
  const generationConfig: Record<string, unknown> = {}
  if (input.speed !== undefined) generationConfig.speed = input.speed
  if (input.emotion !== undefined) generationConfig.emotion = input.emotion
  if (Object.keys(generationConfig).length > 0) requestBody.generation_config = generationConfig
  const outputFormat = isRecordLike(input.outputFormat) ? input.outputFormat : undefined
  requestBody.output_format = outputFormat || {
    container: 'wav',
    encoding: 'pcm_s16le',
    sample_rate: 24000,
  }
  logger.info('Sending Cartesia TTS request', {
    modelId: requestBody.model_id,
    hasVoice: Boolean(requestBody.voice),
    language: requestBody.language,
    hasGenerationConfig: Boolean(requestBody.generation_config),
  })
  const response = await providerFetch(
    'https://api.cartesia.ai/tts/bytes',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
        'Cartesia-Version': '2025-04-16',
      },
      body: JSON.stringify(requestBody),
    },
    signal
  )
  if (!response.ok) {
    const error = await readTtsErrorJson(response, 'Cartesia TTS error response', signal)
    const message = getTtsErrorMessage(error, response.statusText)
    const detail = typeof error.detail === 'string' ? error.detail : ''
    logger.error('Cartesia TTS request failed', { status: response.status, error: message, detail })
    throw new Error(`Cartesia TTS API error: ${message}${detail ? ` - ${detail}` : ''}`)
  }
  const format = typeof outputFormat?.container === 'string' ? outputFormat.container : 'mp3'
  return {
    audioBuffer: await readAudio(response, 'Cartesia TTS audio response', signal),
    format,
    mimeType: getTtsMimeType(format),
  }
}

export async function synthesizeGoogle(
  input: GoogleTtsParams,
  signal?: AbortSignal
): Promise<TtsAudioResult> {
  assertTextWithinLimit(input.text)
  if (!input.languageCode) {
    throw new Error('text, apiKey, and languageCode are required for Google Cloud TTS')
  }
  const audioEncoding = input.audioEncoding || 'MP3'
  const audioConfig: Record<string, unknown> = {
    audioEncoding,
    speakingRate: Math.max(0.25, Math.min(2, input.speakingRate ?? 1)),
    pitch: input.pitch ?? 0,
  }
  if (input.volumeGainDb !== undefined) audioConfig.volumeGainDb = input.volumeGainDb
  if (input.sampleRateHertz) audioConfig.sampleRateHertz = input.sampleRateHertz
  if (input.effectsProfileId?.length) audioConfig.effectsProfileId = input.effectsProfileId
  const voice: Record<string, unknown> = { languageCode: input.languageCode }
  if (input.voiceId) voice.name = input.voiceId
  if (input.gender) voice.ssmlGender = input.gender
  if (!input.voiceId && !input.gender) voice.name = 'en-US-Neural2-C'
  const response = await providerFetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${input.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { text: input.text }, voice, audioConfig }),
    },
    signal
  )
  if (!response.ok) {
    const error = await readTtsErrorJson(response, 'Google TTS error response', signal)
    throw new Error(`Google Cloud TTS API error: ${getTtsErrorMessage(error, response.statusText)}`)
  }
  const data = await readResponseJsonWithLimit<{ audioContent?: string }>(response, {
    maxBytes: MAX_TTS_JSON_BYTES,
    label: 'Google TTS JSON response',
    signal,
  })
  if (!data.audioContent) throw new Error('No audio content returned from Google Cloud TTS')
  const audioBuffer = Buffer.from(data.audioContent, 'base64')
  assertKnownSizeWithinLimit(audioBuffer.length, MAX_TTS_AUDIO_BYTES, 'Google TTS audio response')
  const format = audioEncoding.toLowerCase().replace('_', '')
  return { audioBuffer, format, mimeType: getTtsMimeType(format) }
}

export async function synthesizeAzure(
  input: AzureTtsOperationInput,
  signal?: AbortSignal
): Promise<TtsAudioResult> {
  assertTextWithinLimit(input.text)
  const voiceId = input.voiceId || 'en-US-JennyNeural'
  const region = input.region || 'eastus'
  const outputFormat = input.outputFormat || 'audio-24khz-96kbitrate-mono-mp3'
  const regionPattern = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/
  if (!regionPattern.test(region)) {
    throw new Error(
      'Invalid Azure region: must match /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/ (e.g. eastus, westeurope)'
    )
  }
  let ssml = `<speak version='1.0' xml:lang='en-US' xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts"><voice name='${voiceId}'>`
  if (input.style) {
    ssml += `<mstts:express-as style='${input.style}'`
    if (input.styleDegree) ssml += ` styledegree='${input.styleDegree}'`
    if (input.role) ssml += ` role='${input.role}'`
    ssml += '>'
  }
  if (input.rate || input.pitch) {
    ssml += '<prosody'
    if (input.rate) ssml += ` rate='${input.rate}'`
    if (input.pitch) ssml += ` pitch='${input.pitch}'`
    ssml += '>'
  }
  ssml += input.text
  if (input.rate || input.pitch) ssml += '</prosody>'
  if (input.style) ssml += '</mstts:express-as>'
  ssml += '</voice></speak>'
  const response = await providerFetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': input.apiKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': outputFormat,
      },
      body: ssml,
    },
    signal
  )
  if (!response.ok) {
    const error = await readResponseTextWithLimit(response, {
      maxBytes: MAX_TTS_ERROR_BYTES,
      label: 'Azure TTS error response',
      signal,
    })
    throw new Error(`Azure TTS API error: ${error || response.statusText}`)
  }
  const format = outputFormat.includes('mp3') ? 'mp3' : 'wav'
  return {
    audioBuffer: await readAudio(response, 'Azure TTS audio response', signal),
    format,
    mimeType: getTtsMimeType(format),
  }
}

export async function synthesizePlayHt(
  input: PlayHtTtsParams,
  signal?: AbortSignal
): Promise<TtsAudioResult> {
  assertTextWithinLimit(input.text)
  const format = input.outputFormat || 'mp3'
  const requestBody: Record<string, unknown> = {
    text: input.text,
    quality: input.quality || 'standard',
    output_format: format,
    speed: input.speed ?? 1,
  }
  if (input.voice) requestBody.voice = input.voice
  if (input.temperature !== undefined) requestBody.temperature = input.temperature
  if (input.voiceGuidance !== undefined) requestBody.voice_guidance = input.voiceGuidance
  if (input.textGuidance !== undefined) requestBody.text_guidance = input.textGuidance
  if (input.sampleRate) requestBody.sample_rate = input.sampleRate
  const response = await providerFetch(
    'https://api.play.ht/api/v2/tts/stream',
    {
      method: 'POST',
      headers: {
        AUTHORIZATION: input.apiKey,
        'X-USER-ID': input.userId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    },
    signal
  )
  if (!response.ok) {
    const error = await readTtsErrorJson(response, 'PlayHT TTS error response', signal)
    throw new Error(`PlayHT TTS API error: ${getTtsErrorMessage(error, response.statusText)}`)
  }
  return {
    audioBuffer: await readAudio(response, 'PlayHT TTS audio response', signal),
    format,
    mimeType: getTtsMimeType(format),
  }
}
