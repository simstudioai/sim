import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

export type TtsProvider =
  | 'openai'
  | 'deepgram'
  | 'elevenlabs'
  | 'cartesia'
  | 'google'
  | 'azure'
  | 'playht'

// OpenAI TTS Types
export interface OpenAiTtsParams {
  text: string
  model?: 'tts-1' | 'tts-1-hd' | 'gpt-4o-mini-tts'
  voice?:
    | 'alloy'
    | 'echo'
    | 'fable'
    | 'onyx'
    | 'nova'
    | 'shimmer'
    | 'ash'
    | 'ballad'
    | 'coral'
    | 'sage'
    | 'verse'
  responseFormat?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm'
  speed?: number // 0.25 to 4.0
  apiKey: string
}

// Deepgram TTS Types
export interface DeepgramTtsParams {
  text: string
  model?: string // e.g., 'aura-2'
  voice?: string // e.g., 'aura-asteria-en', 'aura-luna-en', etc.
  encoding?: 'linear16' | 'mp3' | 'opus' | 'aac' | 'flac' | 'mulaw' | 'alaw'
  sampleRate?: number // 8000, 16000, 24000, 48000
  bitRate?: number // For compressed formats
  container?: 'none' | 'wav' | 'ogg'
  apiKey: string
}

// ElevenLabs TTS Types
export interface ElevenLabsTtsUnifiedParams {
  text: string
  voiceId: string
  modelId?: string
  stability?: number // 0.0 to 1.0
  similarityBoost?: number // 0.0 to 1.0
  style?: number // 0.0 to 1.0
  useSpeakerBoost?: boolean
  apiKey: string
}

// Cartesia TTS Types
export interface CartesiaTtsParams {
  text: string
  modelId?: string // e.g., 'sonic-english', 'sonic-multilingual'
  voice?: string // Voice ID or embedding
  language?: string // Language code (en, es, fr, de, it, pt, etc.)
  outputFormat?: {
    container?: 'raw' | 'wav' | 'mp3' | 'ogg'
    encoding?: 'pcm_f32le' | 'pcm_s16le' | 'pcm_mulaw' | 'pcm_alaw'
    sampleRate?: number // 8000, 16000, 22050, 24000, 44100, 48000
  }
  speed?: number // Speed multiplier
  emotion?: string[] // For Sonic-3: e.g., ['positivity:high', 'curiosity:medium']
  apiKey: string
}

// Google Cloud TTS Types
export interface GoogleTtsParams {
  text: string
  voiceId?: string // e.g., 'en-US-Neural2-A'
  languageCode?: string // e.g., 'en-US'
  gender?: 'MALE' | 'FEMALE' | 'NEUTRAL'
  audioEncoding?: 'LINEAR16' | 'MP3' | 'OGG_OPUS' | 'MULAW' | 'ALAW'
  speakingRate?: number // 0.25 to 2.0
  pitch?: number // -20.0 to 20.0
  volumeGainDb?: number // -96.0 to 16.0
  sampleRateHertz?: number
  effectsProfileId?: string[] // e.g., ['headphone-class-device']
  apiKey: string
}

// Azure TTS Types
export interface AzureTtsParams {
  text: string
  voiceId?: string // e.g., 'en-US-JennyNeural'
  region?: string // e.g., 'eastus', 'westus'
  outputFormat?:
    | 'riff-8khz-16bit-mono-pcm'
    | 'riff-24khz-16bit-mono-pcm'
    | 'audio-24khz-48kbitrate-mono-mp3'
    | 'audio-24khz-96kbitrate-mono-mp3'
    | 'audio-48khz-96kbitrate-mono-mp3'
  rate?: string // e.g., '+10%', '-20%', '1.5'
  pitch?: string // e.g., '+5Hz', '-2st', 'low'
  style?: string // e.g., 'cheerful', 'sad', 'angry' (neural voices only)
  styleDegree?: number // 0.01 to 2.0
  role?: string // e.g., 'Girl', 'Boy', 'YoungAdultFemale'
  apiKey: string
}

// PlayHT TTS Types
export interface PlayHtTtsParams {
  text: string
  voice?: string // Voice ID or manifest URL
  quality?: 'draft' | 'standard' | 'premium'
  outputFormat?: 'mp3' | 'wav' | 'ogg' | 'flac' | 'mulaw'
  speed?: number // 0.5 to 2.0
  temperature?: number // 0.0 to 2.0 (creativity/randomness)
  voiceGuidance?: number // 1.0 to 6.0 (voice stability)
  textGuidance?: number // 1.0 to 6.0 (text adherence)
  sampleRate?: number // 8000, 16000, 22050, 24000, 44100, 48000
  userId: string // X-USER-ID header
  apiKey: string // AUTHORIZATION header
}

// Unified Response Type for block outputs
export interface TtsBlockResponse extends ToolResponse {
  output: {
    audioUrl: string
    audioFile?: UserFile
    duration?: number
    characterCount?: number
    format?: string
    provider?: TtsProvider
  }
}

// API Response type (used internally in proxy route)
export interface TtsResponse {
  audioUrl: string
  audioFile?: UserFile
  duration?: number
  characterCount?: number
  format?: string
  provider?: TtsProvider
}

// Voice options for different providers
export const OPENAI_VOICES = {
  // Standard voices (tts-1, tts-1-hd)
  alloy: 'Alloy (neutral, balanced)',
  echo: 'Echo (warm, masculine)',
  fable: 'Fable (soft, British accent)',
  onyx: 'Onyx (deep, authoritative)',
  nova: 'Nova (energetic, youthful)',
  shimmer: 'Shimmer (warm, empathetic)',
  // GPT-4o-mini-tts voices
  ash: 'Ash (masculine, clear)',
  ballad: 'Ballad (smooth, melodic)',
  coral: 'Coral (warm, friendly)',
  sage: 'Sage (calm, wise)',
  verse: 'Verse (poetic, expressive)',
} as const

export const DEEPGRAM_VOICES = {
  // Aura-1 English voices (legacy)
  'aura-asteria-en': 'Asteria (Aura-1, American, warm female)',
  'aura-luna-en': 'Luna (Aura-1, American, professional female)',
  'aura-stella-en': 'Stella (Aura-1, American, energetic female)',
  'aura-athena-en': 'Athena (Aura-1, British, sophisticated female)',
  'aura-hera-en': 'Hera (Aura-1, American, mature female)',
  'aura-orion-en': 'Orion (Aura-1, American, confident male)',
  'aura-arcas-en': 'Arcas (Aura-1, American, professional male)',
  'aura-perseus-en': 'Perseus (Aura-1, American, strong male)',
  'aura-angus-en': 'Angus (Aura-1, Irish, friendly male)',
  'aura-orpheus-en': 'Orpheus (Aura-1, American, smooth male)',
  'aura-helios-en': 'Helios (Aura-1, British, authoritative male)',
  'aura-zeus-en': 'Zeus (Aura-1, American, deep male)',

  // Aura-2 English voices
  'aura-2-arcas-en': 'Arcas (Aura-2, American male)',
  'aura-2-asteria-en': 'Asteria (Aura-2, American female)',
  'aura-2-luna-en': 'Luna (Aura-2, American female)',
  'aura-2-stella-en': 'Stella (Aura-2, American female)',
  'aura-2-athena-en': 'Athena (Aura-2, British female)',
  'aura-2-hera-en': 'Hera (Aura-2, American female)',
  'aura-2-orion-en': 'Orion (Aura-2, American male)',
  'aura-2-perseus-en': 'Perseus (Aura-2, American male)',
  'aura-2-orpheus-en': 'Orpheus (Aura-2, American male)',
  'aura-2-helios-en': 'Helios (Aura-2, British male)',
  'aura-2-zeus-en': 'Zeus (Aura-2, American male)',
  'aura-2-angus-en': 'Angus (Aura-2, Irish male)',
  'aura-2-sasha-en': 'Sasha (Aura-2, American female)',
  'aura-2-sophia-en': 'Sophia (Aura-2, American female)',
  'aura-2-oliver-en': 'Oliver (Aura-2, American male)',
  'aura-2-emma-en': 'Emma (Aura-2, American female)',
  'aura-2-jack-en': 'Jack (Aura-2, American male)',
  'aura-2-lily-en': 'Lily (Aura-2, American female)',
  'aura-2-noah-en': 'Noah (Aura-2, American male)',
  'aura-2-mia-en': 'Mia (Aura-2, American female)',
  'aura-2-william-en': 'William (Aura-2, American male)',
  'aura-2-emily-en': 'Emily (Aura-2, American female)',
  'aura-2-james-en': 'James (Aura-2, American male)',
  'aura-2-ava-en': 'Ava (Aura-2, American female)',
  'aura-2-benjamin-en': 'Benjamin (Aura-2, American male)',
  'aura-2-charlotte-en': 'Charlotte (Aura-2, American female)',
  'aura-2-lucas-en': 'Lucas (Aura-2, American male)',
  'aura-2-harper-en': 'Harper (Aura-2, American female)',
  'aura-2-henry-en': 'Henry (Aura-2, American male)',
  'aura-2-evelyn-en': 'Evelyn (Aura-2, American female)',
  'aura-2-alexander-en': 'Alexander (Aura-2, American male)',
  'aura-2-abigail-en': 'Abigail (Aura-2, American female)',
  'aura-2-michael-en': 'Michael (Aura-2, American male)',
  'aura-2-sofia-en': 'Sofia (Aura-2, American female)',
  'aura-2-daniel-en': 'Daniel (Aura-2, American male)',
  'aura-2-ella-en': 'Ella (Aura-2, American female)',
  'aura-2-matthew-en': 'Matthew (Aura-2, American male)',
  'aura-2-grace-en': 'Grace (Aura-2, American female)',
  'aura-2-jackson-en': 'Jackson (Aura-2, American male)',
  'aura-2-chloe-en': 'Chloe (Aura-2, American female)',
  'aura-2-samuel-en': 'Samuel (Aura-2, American male)',
  'aura-2-madison-en': 'Madison (Aura-2, American female)',

  // Aura-2 Spanish voices
  'aura-2-maria-es': 'Maria (Aura-2, Spanish female)',
  'aura-2-carmen-es': 'Carmen (Aura-2, Spanish female)',
  'aura-2-carlos-es': 'Carlos (Aura-2, Spanish male)',
  'aura-2-diego-es': 'Diego (Aura-2, Spanish male)',
  'aura-2-isabel-es': 'Isabel (Aura-2, Spanish female)',
  'aura-2-juan-es': 'Juan (Aura-2, Spanish male)',
  'aura-2-lucia-es': 'Lucia (Aura-2, Spanish female)',
  'aura-2-miguel-es': 'Miguel (Aura-2, Spanish male)',
  'aura-2-sofia-es': 'Sofia (Aura-2, Spanish female)',
  'aura-2-antonio-es': 'Antonio (Aura-2, Spanish male)',
} as const

export const ELEVENLABS_MODELS = {
  // V2 Models
  eleven_turbo_v2_5: 'Turbo v2.5 (faster, improved)',
  eleven_flash_v2_5: 'Flash v2.5 (ultra-fast, 75ms latency)',
  eleven_multilingual_v2: 'Multilingual v2 (32 languages)',
  eleven_turbo_v2: 'Turbo v2 (fast, good quality)',

  // V1 Models
  eleven_monolingual_v1: 'Monolingual v1 (English only)',
  eleven_multilingual_v1: 'Multilingual v1',
} as const

export const CARTESIA_MODELS = {
  sonic: 'Sonic (English, low latency)',
  'sonic-2': 'Sonic 2 (English, improved)',
  'sonic-turbo': 'Sonic Turbo (English, ultra-fast)',
  'sonic-3': 'Sonic 3 (English, highest quality)',
  'sonic-multilingual': 'Sonic Multilingual (100+ languages)',
} as const

export const GOOGLE_VOICE_GENDERS = {
  MALE: 'Male',
  FEMALE: 'Female',
  NEUTRAL: 'Neutral',
} as const

export const GOOGLE_AUDIO_ENCODINGS = {
  LINEAR16: 'LINEAR16 (uncompressed)',
  MP3: 'MP3 (compressed)',
  OGG_OPUS: 'OGG Opus (compressed)',
  MULAW: 'MULAW (8kHz)',
  ALAW: 'ALAW (8kHz)',
} as const

export const AZURE_OUTPUT_FORMATS = {
  'riff-8khz-16bit-mono-pcm': 'PCM 8kHz 16-bit',
  'riff-24khz-16bit-mono-pcm': 'PCM 24kHz 16-bit',
  'audio-24khz-48kbitrate-mono-mp3': 'MP3 24kHz 48kbps',
  'audio-24khz-96kbitrate-mono-mp3': 'MP3 24kHz 96kbps',
  'audio-48khz-96kbitrate-mono-mp3': 'MP3 48kHz 96kbps (high quality)',
} as const

export const PLAYHT_QUALITY_LEVELS = {
  draft: 'Draft (fastest)',
  standard: 'Standard (recommended)',
  premium: 'Premium (best quality)',
} as const

export const PLAYHT_OUTPUT_FORMATS = {
  mp3: 'MP3',
  wav: 'WAV',
  ogg: 'OGG',
  flac: 'FLAC',
  mulaw: 'MULAW',
} as const

// Audio format MIME types
export const AUDIO_MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  opus: 'audio/opus',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  pcm: 'audio/pcm',
  linear16: 'audio/pcm',
  mulaw: 'audio/basic',
  alaw: 'audio/basic',
  ogg: 'audio/ogg',
}

// Get file extension from format
export function getFileExtension(format: string): string {
  const formatMap: Record<string, string> = {
    mp3: 'mp3',
    opus: 'opus',
    aac: 'aac',
    flac: 'flac',
    wav: 'wav',
    pcm: 'pcm',
    linear16: 'wav',
    mulaw: 'wav',
    alaw: 'wav',
    ogg: 'ogg',
  }
  return formatMap[format] || 'mp3'
}

// Get MIME type from format
export function getMimeType(format: string): string {
  return AUDIO_MIME_TYPES[format] || 'audio/mpeg'
}
