import type { SttParams, SttResponse, SttV2Params } from '@/tools/stt/types'
import { STT_SEGMENT_OUTPUT_PROPERTIES } from '@/tools/stt/types'
import type { ToolConfig } from '@/tools/types'

export const deepgramSttTool: ToolConfig<SttParams, SttResponse> = {
  id: 'stt_deepgram',
  name: 'Deepgram STT',
  description: 'Transcribe audio to text using Deepgram',
  version: '1.0.0',

  params: {
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'STT provider (deepgram)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Deepgram API key',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Deepgram model to use (nova-3, nova-2, whisper-large, etc.)',
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
    diarization: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Enable speaker diarization',
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
      provider: 'deepgram',
      apiKey: params.apiKey,
      model: params.model,
      audioFile: params.audioFile,
      audioFileReference: params.audioFileReference,
      audioUrl: params.audioUrl,
      language: params.language || 'auto',
      timestamps: params.timestamps || 'none',
      diarization: params.diarization || false,
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
    segments: {
      type: 'array',
      description: 'Timestamped segments with speaker labels',
      items: {
        type: 'object',
        properties: STT_SEGMENT_OUTPUT_PROPERTIES,
      },
    },
    language: { type: 'string', description: 'Detected or specified language' },
    duration: { type: 'number', description: 'Audio duration in seconds' },
    confidence: { type: 'number', description: 'Overall confidence score' },
  },
}

const deepgramSttV2Params = {
  provider: deepgramSttTool.params.provider,
  apiKey: deepgramSttTool.params.apiKey,
  model: deepgramSttTool.params.model,
  audioFile: deepgramSttTool.params.audioFile,
  audioFileReference: deepgramSttTool.params.audioFileReference,
  language: deepgramSttTool.params.language,
  timestamps: deepgramSttTool.params.timestamps,
  diarization: deepgramSttTool.params.diarization,
  translateToEnglish: deepgramSttTool.params.translateToEnglish,
} satisfies ToolConfig['params']

export const deepgramSttV2Tool: ToolConfig<SttV2Params, SttResponse> = {
  ...deepgramSttTool,
  id: 'stt_deepgram_v2',
  name: 'Deepgram STT',
  params: deepgramSttV2Params,
  request: {
    ...deepgramSttTool.request,
    body: (
      params: SttV2Params & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
      }
    ) => ({
      provider: 'deepgram',
      apiKey: params.apiKey,
      model: params.model,
      audioFile: params.audioFile,
      audioFileReference: params.audioFileReference,
      language: params.language || 'auto',
      timestamps: params.timestamps || 'none',
      diarization: params.diarization || false,
      translateToEnglish: params.translateToEnglish || false,
      workspaceId: params._context?.workspaceId,
      workflowId: params._context?.workflowId,
      executionId: params._context?.executionId,
    }),
  },
}
