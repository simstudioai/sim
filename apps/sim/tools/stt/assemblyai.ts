import type { SttParams, SttResponse, SttV2Params } from '@/tools/stt/types'
import {
  STT_ENTITY_OUTPUT_PROPERTIES,
  STT_SEGMENT_OUTPUT_PROPERTIES,
  STT_SENTIMENT_OUTPUT_PROPERTIES,
} from '@/tools/stt/types'
import type { ToolConfig } from '@/tools/types'

export const assemblyaiSttTool: ToolConfig<SttParams, SttResponse> = {
  id: 'stt_assemblyai',
  name: 'AssemblyAI STT',
  description: 'Transcribe audio to text using AssemblyAI with advanced NLP features',
  version: '1.0.0',

  params: {
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'STT provider (assemblyai)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AssemblyAI API key',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'AssemblyAI model to use (default: best)',
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
    sentiment: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Enable sentiment analysis',
    },
    entityDetection: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Enable entity detection',
    },
    piiRedaction: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Enable PII redaction',
    },
    summarization: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Enable automatic summarization',
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
      provider: 'assemblyai',
      apiKey: params.apiKey,
      model: params.model,
      audioFile: params.audioFile,
      audioFileReference: params.audioFileReference,
      audioUrl: params.audioUrl,
      language: params.language || 'auto',
      timestamps: params.timestamps || 'none',
      diarization: params.diarization || false,
      sentiment: (params as any).sentiment || false,
      entityDetection: (params as any).entityDetection || false,
      piiRedaction: (params as any).piiRedaction || false,
      summarization: (params as any).summarization || false,
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
        sentiment: data.sentiment,
        entities: data.entities,
        summary: data.summary,
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
    sentiment: {
      type: 'array',
      description: 'Sentiment analysis results',
      items: {
        type: 'object',
        properties: STT_SENTIMENT_OUTPUT_PROPERTIES,
      },
    },
    entities: {
      type: 'array',
      description: 'Detected entities',
      items: {
        type: 'object',
        properties: STT_ENTITY_OUTPUT_PROPERTIES,
      },
    },
    summary: { type: 'string', description: 'Auto-generated summary' },
  },
}

const assemblyaiSttV2Params = {
  provider: assemblyaiSttTool.params.provider,
  apiKey: assemblyaiSttTool.params.apiKey,
  model: assemblyaiSttTool.params.model,
  audioFile: assemblyaiSttTool.params.audioFile,
  audioFileReference: assemblyaiSttTool.params.audioFileReference,
  language: assemblyaiSttTool.params.language,
  timestamps: assemblyaiSttTool.params.timestamps,
  diarization: assemblyaiSttTool.params.diarization,
  sentiment: assemblyaiSttTool.params.sentiment,
  entityDetection: assemblyaiSttTool.params.entityDetection,
  piiRedaction: assemblyaiSttTool.params.piiRedaction,
  summarization: assemblyaiSttTool.params.summarization,
} satisfies ToolConfig['params']

export const assemblyaiSttV2Tool: ToolConfig<SttV2Params, SttResponse> = {
  ...assemblyaiSttTool,
  id: 'stt_assemblyai_v2',
  name: 'AssemblyAI STT',
  params: assemblyaiSttV2Params,
  request: {
    ...assemblyaiSttTool.request,
    body: (
      params: SttV2Params & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
      }
    ) => ({
      provider: 'assemblyai',
      apiKey: params.apiKey,
      model: params.model,
      audioFile: params.audioFile,
      audioFileReference: params.audioFileReference,
      language: params.language || 'auto',
      timestamps: params.timestamps || 'none',
      diarization: params.diarization || false,
      sentiment: params.sentiment || false,
      entityDetection: params.entityDetection || false,
      piiRedaction: params.piiRedaction || false,
      summarization: params.summarization || false,
      workspaceId: params._context?.workspaceId,
      workflowId: params._context?.workflowId,
      executionId: params._context?.executionId,
    }),
  },
}
