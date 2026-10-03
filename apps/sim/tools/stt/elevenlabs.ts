import type { SttParams, SttResponse, SttV2Params } from '@/tools/stt/types'
import type { InternalToolConfig } from '@/tools/types'

export const elevenLabsSttTool: InternalToolConfig<SttParams, SttResponse> = {
  id: 'stt_elevenlabs',
  name: 'ElevenLabs STT',
  description: 'Transcribe audio to text using ElevenLabs',
  version: '1.0.0',

  params: {
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'STT provider (elevenlabs)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ElevenLabs API key',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ElevenLabs model to use (scribe_v2)',
    },
    audioFile: {
      type: 'file',
      required: false,
      visibility: 'user-only',
      description: 'Audio or video file to transcribe (e.g., MP3, WAV, M4A, WEBM)',
    },
    audioFileReference: {
      type: 'file',
      required: false,
      visibility: 'user-only',
      description: 'Reference to audio/video file from previous blocks',
    },
    audioUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL to audio or video file',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language code (e.g., "en", "es", "fr") or "auto" for auto-detection',
    },
    timestamps: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Timestamp granularity: none, sentence, or word',
    },
  },

  operation: {
    modelInput: {
      mode: 'project',
      select: (params) => ({ language: params.language }),
    },
    input: (params) => ({
      provider: 'elevenlabs',
      apiKey: params.apiKey,
      model: 'scribe_v2',
      audioFile: params.audioFile,
      audioFileReference: params.audioFileReference,
      audioUrl: params.audioUrl,
      language: params.language || 'auto',
      timestamps: params.timestamps || 'none',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok || data.error) {
      return {
        success: false,
        error: data.error || 'Transcription failed',
        output: {
          transcript: '',
        },
      }
    }

    return {
      success: true,
      output: {
        transcript: data.transcript,
        segments: data.segments,
        language: data.language,
        duration: data.duration,
        confidence: data.confidence,
      },
    }
  },

  outputs: {
    transcript: { type: 'string', description: 'Full transcribed text' },
    segments: { type: 'array', description: 'Timestamped segments' },
    language: { type: 'string', description: 'Detected or specified language' },
    duration: { type: 'number', description: 'Audio duration in seconds' },
    confidence: { type: 'number', description: 'Overall confidence score' },
  },
}

const elevenLabsSttV2Params = {
  provider: elevenLabsSttTool.params.provider,
  apiKey: elevenLabsSttTool.params.apiKey,
  model: elevenLabsSttTool.params.model,
  audioFile: elevenLabsSttTool.params.audioFile,
  audioFileReference: elevenLabsSttTool.params.audioFileReference,
  language: elevenLabsSttTool.params.language,
  timestamps: elevenLabsSttTool.params.timestamps,
} satisfies InternalToolConfig['params']

export const elevenLabsSttV2Tool: InternalToolConfig<SttV2Params, SttResponse> = {
  ...elevenLabsSttTool,
  id: 'stt_elevenlabs_v2',
  name: 'ElevenLabs STT',
  params: elevenLabsSttV2Params,
  operation: {
    ...elevenLabsSttTool.operation,
    input: (params) => ({
      provider: 'elevenlabs',
      apiKey: params.apiKey,
      model: 'scribe_v2',
      audioFile: params.audioFile,
      audioFileReference: params.audioFileReference,
      language: params.language || 'auto',
      timestamps: params.timestamps || 'none',
    }),
  },
}
