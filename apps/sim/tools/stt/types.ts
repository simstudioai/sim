import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

export interface SttParams {
  provider: 'whisper' | 'deepgram' | 'elevenlabs'
  apiKey: string
  model?: string
  audioFile?: UserFile | UserFile[]
  audioFileReference?: UserFile | UserFile[]
  audioUrl?: string
  language?: string
  timestamps?: 'none' | 'sentence' | 'word'
  diarization?: boolean
  translateToEnglish?: boolean
}

export interface TranscriptSegment {
  text: string
  start: number
  end: number
  speaker?: string
  confidence?: number
}

export interface SttResponse extends ToolResponse {
  output: {
    transcript: string
    segments?: TranscriptSegment[]
    language?: string
    duration?: number
    confidence?: number
  }
}

export interface SttBlockResponse extends ToolResponse {
  output: {
    transcript: string
    segments?: TranscriptSegment[]
    language?: string
    duration?: number
    confidence?: number
  }
}

// Provider-specific types

export interface WhisperParams extends Omit<SttParams, 'provider'> {
  model?: string
  responseFormat?: 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt'
  temperature?: number
}

export interface DeepgramParams extends Omit<SttParams, 'provider'> {
  model?: string
  punctuate?: boolean
  paragraphs?: boolean
  utterances?: boolean
}

export interface ElevenLabsSttParams extends Omit<SttParams, 'provider'> {
  model?: string
}
