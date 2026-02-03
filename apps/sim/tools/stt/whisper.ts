import type { SttParams, SttResponse, SttV2Params } from '@/tools/stt/types'
import { STT_SEGMENT_OUTPUT_PROPERTIES } from '@/tools/stt/types'
import type { ToolConfig } from '@/tools/types'

export const whisperSttTool: ToolConfig<SttParams, SttResponse> = {
  id: 'stt_whisper',
  name: 'OpenAI Whisper STT',
  description: 'Transcribe audio to text using OpenAI Whisper',
  version: '1.0.0',

  params: {
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'STT provider (whisper)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'OpenAI API key',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whisper model to use (default: whisper-1)',
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
    translateToEnglish: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Translate audio to English',
    },
    prompt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Optional text to guide the model's style or continue a previous audio segment. Helps with proper nouns and context.",
    },
    temperature: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sampling temperature between 0 and 1. Higher values make output more random, lower values more focused and deterministic.',
    },
    responseFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Output format for the transcription (e.g., "json", "text", "srt", "verbose_json", "vtt")',
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
      provider: 'whisper',
      apiKey: params.apiKey,
      model: params.model,
      audioFile: params.audioFile,
      audioFileReference: params.audioFileReference,
      audioUrl: params.audioUrl,
      language: params.language || 'auto',
      timestamps: params.timestamps || 'none',
      translateToEnglish: params.translateToEnglish || false,
      prompt: (params as any).prompt,
      temperature: (params as any).temperature,
      responseFormat: (params as any).responseFormat,
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
      },
    }
  },

  outputs: {
    transcript: { type: 'string', description: 'Full transcribed text' },
    segments: {
      type: 'array',
      description: 'Timestamped segments',
      items: {
        type: 'object',
        properties: STT_SEGMENT_OUTPUT_PROPERTIES,
      },
    },
    language: { type: 'string', description: 'Detected or specified language' },
    duration: { type: 'number', description: 'Audio duration in seconds' },
  },
}

const whisperSttV2Params = {
  provider: whisperSttTool.params.provider,
  apiKey: whisperSttTool.params.apiKey,
  model: whisperSttTool.params.model,
  audioFile: whisperSttTool.params.audioFile,
  audioFileReference: whisperSttTool.params.audioFileReference,
  language: whisperSttTool.params.language,
  timestamps: whisperSttTool.params.timestamps,
  translateToEnglish: whisperSttTool.params.translateToEnglish,
  prompt: whisperSttTool.params.prompt,
  temperature: whisperSttTool.params.temperature,
  responseFormat: whisperSttTool.params.responseFormat,
} satisfies ToolConfig['params']

export const whisperSttV2Tool: ToolConfig<SttV2Params, SttResponse> = {
  ...whisperSttTool,
  id: 'stt_whisper_v2',
  name: 'OpenAI Whisper STT',
  params: whisperSttV2Params,
  request: {
    ...whisperSttTool.request,
    body: (
      params: SttV2Params & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
      }
    ) => ({
      provider: 'whisper',
      apiKey: params.apiKey,
      model: params.model,
      audioFile: params.audioFile,
      audioFileReference: params.audioFileReference,
      language: params.language || 'auto',
      timestamps: params.timestamps || 'none',
      translateToEnglish: params.translateToEnglish || false,
      prompt: (params as any).prompt,
      temperature: (params as any).temperature,
      responseFormat: (params as any).responseFormat,
      workspaceId: params._context?.workspaceId,
      workflowId: params._context?.workflowId,
      executionId: params._context?.executionId,
    }),
  },
}
