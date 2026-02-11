import type { SttParams, SttResponse, SttV2Params } from '@/tools/stt/types'
import type { ToolConfig } from '@/tools/types'

export const geminiSttTool: ToolConfig<SttParams, SttResponse> = {
  id: 'stt_gemini',
  name: 'Google Gemini STT',
  description: 'Transcribe audio to text using Google Gemini with multimodal capabilities',
  version: '1.0.0',

  params: {
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'STT provider (gemini)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Google API key',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Gemini model to use (default: gemini-2.5-flash)',
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
      provider: 'gemini',
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

const geminiSttV2Params = {
  provider: geminiSttTool.params.provider,
  apiKey: geminiSttTool.params.apiKey,
  model: geminiSttTool.params.model,
  audioFile: geminiSttTool.params.audioFile,
  audioFileReference: geminiSttTool.params.audioFileReference,
  language: geminiSttTool.params.language,
  timestamps: geminiSttTool.params.timestamps,
} satisfies ToolConfig['params']

export const geminiSttV2Tool: ToolConfig<SttV2Params, SttResponse> = {
  ...geminiSttTool,
  id: 'stt_gemini_v2',
  name: 'Gemini STT',
  params: geminiSttV2Params,
  request: {
    ...geminiSttTool.request,
    body: (
      params: SttV2Params & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
      }
    ) => ({
      provider: 'gemini',
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
