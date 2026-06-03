import { downloadFalMedia, extractFalMediaUrl, getFalApiKey, runFalQueue } from '@/lib/media/falai'
import { type FalAICostMetadata, getFalAICostMetadata } from '@/lib/tools/falai-pricing'

export type AudioType = 'speech' | 'music' | 'sfx'

// Latest-generation fal.ai audio models (2026). Speech leads the TTS arena;
// no GPT-4-tier voices. `model` on the tool can override any of these.
export const DEFAULT_AUDIO_MODELS: Record<AudioType, string> = {
  speech: 'fal-ai/gemini-3.1-flash-tts',
  music: 'fal-ai/minimax-music/v2.6',
  sfx: 'fal-ai/elevenlabs/sound-effects/v2',
}

// Zero-shot voice cloning from a reference sample (F5-TTS: ref_audio_url + gen_text).
export const DEFAULT_CLONE_MODEL = 'fal-ai/f5-tts'

export interface GenerateFalAudioParams {
  prompt: string
  type?: AudioType
  model?: string
  voice?: string
  duration?: number
  /** When set, clones the voice from this reference sample (data URI) via a zero-shot clone model. */
  voiceSampleDataUri?: string
}

export interface GeneratedAudio {
  buffer: Buffer
  contentType: string
  type: AudioType
  model: string
  jobId: string
  cost: FalAICostMetadata
}

function buildInput(type: AudioType, params: GenerateFalAudioParams): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  if (type === 'speech') {
    // Gemini 3.1 Flash TTS takes the text (with optional inline tags) in `prompt`.
    input.prompt = params.prompt
    if (params.voice) input.voice = params.voice
  } else if (type === 'sfx') {
    // ElevenLabs sound-effects take `text`.
    input.text = params.prompt
    if (params.duration !== undefined) input.duration_seconds = params.duration
  } else {
    // Music models take a `prompt` describing the track.
    input.prompt = params.prompt
    if (params.duration !== undefined) input.duration = params.duration
  }
  return input
}

export async function generateFalAudio(params: GenerateFalAudioParams): Promise<GeneratedAudio> {
  const type: AudioType = params.type || 'speech'
  const apiKey = getFalApiKey()

  // Voice cloning: a reference sample routes to a zero-shot clone model (F5-TTS),
  // which conditions on the sample (ref_audio_url) and speaks the prompt in that voice.
  if (params.voiceSampleDataUri) {
    const model = params.model || DEFAULT_CLONE_MODEL
    const input: Record<string, unknown> = {
      gen_text: params.prompt,
      ref_audio_url: params.voiceSampleDataUri,
      model_type: 'F5-TTS',
    }
    const { requestId, data } = await runFalQueue(model, input, apiKey)
    const url = extractFalMediaUrl(data, ['audio', 'audio_url', 'audio_file', 'output'])
    if (!url) throw new Error('No audio URL in Fal.ai clone response')
    const { buffer, contentType } = await downloadFalMedia(url)
    const cost = await getFalAICostMetadata({ apiKey, endpointId: model, requestId })
    return {
      buffer,
      contentType: contentType.startsWith('audio/') ? contentType : 'audio/mpeg',
      type: 'speech',
      model,
      jobId: requestId,
      cost,
    }
  }

  const model = params.model || DEFAULT_AUDIO_MODELS[type]
  const input = buildInput(type, params)

  // For fal audio models the model ID is the queue endpoint.
  const { requestId, data } = await runFalQueue(model, input, apiKey)
  const url = extractFalMediaUrl(data, ['audio', 'audio_url', 'audio_file', 'output'])
  if (!url) throw new Error('No audio URL in Fal.ai response')

  const { buffer, contentType } = await downloadFalMedia(url)
  const cost = await getFalAICostMetadata({ apiKey, endpointId: model, requestId })

  return {
    buffer,
    contentType: contentType.startsWith('audio/') ? contentType : 'audio/mpeg',
    type,
    model,
    jobId: requestId,
    cost,
  }
}
