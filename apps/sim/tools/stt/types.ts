import type { UserFile } from '@/executor/types'
import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Output property definitions for Speech-to-Text API responses.
 * Covers multiple providers: OpenAI Whisper, Deepgram, ElevenLabs, AssemblyAI, Google Gemini.
 */

/**
 * Output definition for transcript segment objects.
 * @see https://platform.openai.com/docs/api-reference/audio/verbose-json-object
 * @see https://developers.deepgram.com/docs/transcription-results
 * @see https://www.assemblyai.com/docs/api-reference/transcripts
 */
export const STT_SEGMENT_OUTPUT_PROPERTIES = {
  text: { type: 'string', description: 'Transcribed text for this segment' },
  start: { type: 'number', description: 'Start time in seconds' },
  end: { type: 'number', description: 'End time in seconds' },
  speaker: {
    type: 'string',
    description: 'Speaker identifier (if diarization enabled)',
    optional: true,
  },
  confidence: { type: 'number', description: 'Confidence score (0-1)', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete segment output definition
 */
export const STT_SEGMENT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Transcript segment with timing information',
  properties: STT_SEGMENT_OUTPUT_PROPERTIES,
}

/**
 * Output definition for sentiment analysis results (AssemblyAI).
 * @see https://www.assemblyai.com/docs/audio-intelligence/sentiment-analysis
 */
export const STT_SENTIMENT_OUTPUT_PROPERTIES = {
  text: { type: 'string', description: 'Text that was analyzed' },
  sentiment: { type: 'string', description: 'Sentiment (POSITIVE, NEGATIVE, NEUTRAL)' },
  confidence: { type: 'number', description: 'Confidence score' },
  start: { type: 'number', description: 'Start time in milliseconds', optional: true },
  end: { type: 'number', description: 'End time in milliseconds', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for entity detection results (AssemblyAI).
 * @see https://www.assemblyai.com/docs/audio-intelligence/entity-detection
 */
export const STT_ENTITY_OUTPUT_PROPERTIES = {
  entity_type: {
    type: 'string',
    description: 'Entity type (e.g., person_name, location, organization)',
  },
  text: { type: 'string', description: 'Entity text' },
  start: { type: 'number', description: 'Start time in milliseconds', optional: true },
  end: { type: 'number', description: 'End time in milliseconds', optional: true },
} as const satisfies Record<string, OutputProperty>

export interface SttParams {
  provider: 'whisper' | 'deepgram' | 'elevenlabs' | 'assemblyai' | 'gemini'
  apiKey: string
  model?: string
  audioFile?: UserFile | UserFile[]
  audioFileReference?: UserFile | UserFile[]
  audioUrl?: string
  language?: string
  timestamps?: 'none' | 'sentence' | 'word'
  diarization?: boolean
  translateToEnglish?: boolean
  // AssemblyAI-specific options
  sentiment?: boolean
  entityDetection?: boolean
  piiRedaction?: boolean
  summarization?: boolean
}

export interface SttV2Params extends Omit<SttParams, 'audioUrl'> {}

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
    // AssemblyAI-specific outputs
    sentiment?: any[]
    entities?: any[]
    summary?: string
  }
}

export interface SttBlockResponse extends ToolResponse {
  output: {
    transcript: string
    segments?: TranscriptSegment[]
    language?: string
    duration?: number
    confidence?: number
    // AssemblyAI-specific outputs
    sentiment?: any[]
    entities?: any[]
    summary?: string
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

export interface AssemblyAIParams extends Omit<SttParams, 'provider'> {
  model?: string
  sentiment?: boolean
  entityDetection?: boolean
  piiRedaction?: boolean
  summarization?: boolean
}

export interface GeminiParams extends Omit<SttParams, 'provider'> {
  model?: string
}
