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
    | 'ash'
    | 'ballad'
    | 'cedar'
    | 'coral'
    | 'echo'
    | 'marin'
    | 'sage'
    | 'shimmer'
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
