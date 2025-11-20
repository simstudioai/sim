import type { SttParams, SttResponse } from '@/tools/stt/types'
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
      visibility: 'user-or-llm',
      description: 'Audio or video file to transcribe',
    },
    audioFileReference: {
      type: 'file',
      required: false,
      visibility: 'user-or-llm',
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
  },

  request: {
    url: '/api/proxy/stt',
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
