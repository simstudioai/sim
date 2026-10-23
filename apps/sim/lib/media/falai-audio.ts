import {
  downloadFalMedia,
  extractFalMediaUrl,
  type FalCostRecorder,
  getFalApiKey,
  recordFalCost,
  runFalQueue,
} from '@/lib/media/falai'
import type { FalAICostMetadata } from '@/lib/tools/falai-pricing'

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

/** The prebuilt voices fal's Gemini TTS endpoints accept; any other `voice` is a 422. */
const GEMINI_TTS_VOICES = [
  'Achernar',
  'Achird',
  'Algenib',
  'Algieba',
  'Alnilam',
  'Aoede',
  'Autonoe',
  'Callirrhoe',
  'Charon',
  'Despina',
  'Enceladus',
  'Erinome',
  'Fenrir',
  'Gacrux',
  'Iapetus',
  'Kore',
  'Laomedeia',
  'Leda',
  'Orus',
  'Pulcherrima',
  'Puck',
  'Rasalgethi',
  'Sadachbia',
  'Sadaltager',
  'Schedar',
  'Sulafat',
  'Umbriel',
  'Vindemiatrix',
  'Zephyr',
  'Zubenelgenubi',
] as const

/**
 * Refuses a voice the speech model does not offer before anything is submitted, naming the
 * voices it does: an ElevenLabs name sent to Gemini TTS is otherwise a bare 422 from fal.
 */
function assertSpeechVoiceSupported(model: string, voice: string | undefined): void {
  if (!voice || !/gemini.*tts/.test(model)) return
  if ((GEMINI_TTS_VOICES as readonly string[]).includes(voice)) return
  throw new Error(
    `Voice "${voice}" is not available for ${model}. Use one of: ${GEMINI_TTS_VOICES.join(', ')}.`
  )
}

export interface GenerateFalAudioParams {
  prompt: string
  type?: AudioType
  model?: string
  voice?: string
  duration?: number
  /** For music: explicit lyrics (with optional [Verse]/[Chorus] tags). Implies a vocal track. */
  lyrics?: string
  /** For music: true = instrumental (no vocals, default); false = vocal track. */
  instrumental?: boolean
  /** When set, clones the voice from this reference sample (data URI) via a zero-shot clone model. */
  voiceSampleDataUri?: string
  /** Ends the generation: the queued request is cancelled and every wait stops. */
  signal?: AbortSignal
  /** Bills the generation once fal completes it, even if a Stop then ends the download. */
  onCost: FalCostRecorder
}

export interface GeneratedAudio {
  buffer: Buffer
  contentType: string
  type: AudioType
  model: string
  jobId: string
  cost: FalAICostMetadata
}

function buildInput(
  type: AudioType,
  params: GenerateFalAudioParams,
  model: string
): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  if (type === 'speech') {
    // ElevenLabs TTS requires `text`; Gemini 3.1 Flash TTS takes the text (with optional inline tags) in `prompt`.
    if (model.includes('elevenlabs/tts')) input.text = params.prompt
    else input.prompt = params.prompt
    if (params.voice) input.voice = params.voice
  } else if (type === 'sfx') {
    // ElevenLabs sound-effects take `text`.
    input.text = params.prompt
    if (params.duration !== undefined) input.duration_seconds = params.duration
  } else {
    // Music. Two modes, both supported:
    //  - instrumental bed (default): no vocals, no lyrics required
    //  - song with vocals: explicit `lyrics`, or auto-written from the prompt
    input.prompt = params.prompt
    const wantsVocals = params.instrumental === false || Boolean(params.lyrics)
    if (model.includes('minimax')) {
      // MiniMax Music 2.6 requires `lyrics` unless is_instrumental=true, and rejects a
      // top-level `duration` (that combination is the 422 we were hitting on every call).
      if (wantsVocals) {
        input.is_instrumental = false
        if (params.lyrics) input.lyrics = params.lyrics
        else input.lyrics_optimizer = true
      } else {
        input.is_instrumental = true
      }
    } else if (model.includes('elevenlabs/music')) {
      if (!wantsVocals) input.force_instrumental = true
      if (params.lyrics) input.prompt = `${params.prompt}\n\nLyrics:\n${params.lyrics}`
      if (params.duration !== undefined) input.music_length_ms = Math.round(params.duration * 1000)
    } else {
      // Other music models: best-effort passthrough.
      if (params.instrumental !== undefined) input.instrumental = params.instrumental
      if (params.lyrics) input.lyrics = params.lyrics
      if (params.duration !== undefined) input.duration = params.duration
    }
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
    const { requestId, data } = await runFalQueue(model, input, apiKey, params.signal)
    const cost = await recordFalCost(apiKey, model, requestId, params.onCost)
    const url = extractFalMediaUrl(data, ['audio', 'audio_url', 'audio_file', 'output'])
    if (!url) throw new Error('No audio URL in Fal.ai clone response')
    const { buffer, contentType } = await downloadFalMedia(url, params.signal)
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
  if (type === 'speech') assertSpeechVoiceSupported(model, params.voice)
  const input = buildInput(type, params, model)

  // For fal audio models the model ID is the queue endpoint.
  const { requestId, data } = await runFalQueue(model, input, apiKey, params.signal)
  const cost = await recordFalCost(apiKey, model, requestId, params.onCost)
  const url = extractFalMediaUrl(data, ['audio', 'audio_url', 'audio_file', 'output'])
  if (!url) throw new Error('No audio URL in Fal.ai response')

  const { buffer, contentType } = await downloadFalMedia(url, params.signal)

  return {
    buffer,
    contentType: contentType.startsWith('audio/') ? contentType : 'audio/mpeg',
    type,
    model,
    jobId: requestId,
    cost,
  }
}
