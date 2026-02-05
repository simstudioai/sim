import type { SttParams, SttResponse, SttV2Params } from '@/tools/stt/types'
import type { ToolConfig } from '@/tools/types'

export const elevenLabsSttTool: ToolConfig<SttParams, SttResponse> = {
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
      description: 'ElevenLabs model to use (scribe_v1, scribe_v1_experimental)',
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

  request: {
    url: '/api/tools/stt',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (
      params: SttParams & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
      }
    ) => ({
      provider: 'elevenlabs',
      apiKey: params.apiKey,
      model: params.model,
      audioFile: params.audioFile,
      audioFileReference: params.audioFileReference,
      audioUrl: params.audioUrl,
      language: params.language || 'auto',
      timestamps: params.timestamps || 'none',
      workspaceId: params._context?.workspaceId,
      workflowId: params._context?.workflowId,
      executionId: params._context?.executionId,
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
} satisfies ToolConfig['params']

export const elevenLabsSttV2Tool: ToolConfig<SttV2Params, SttResponse> = {
  ...elevenLabsSttTool,
  id: 'stt_elevenlabs_v2',
  name: 'ElevenLabs STT',
  params: elevenLabsSttV2Params,
  request: {
    ...elevenLabsSttTool.request,
    body: (
      params: SttV2Params & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
      }
    ) => ({
      provider: 'elevenlabs',
      apiKey: params.apiKey,
      model: params.model,
      audioFile: params.audioFile,
      audioFileReference: params.audioFileReference,
      language: params.language || 'auto',
      timestamps: params.timestamps || 'none',
      workspaceId: params._context?.workspaceId,
      workflowId: params._context?.workflowId,
      executionId: params._context?.executionId,
    }),
  },
}
