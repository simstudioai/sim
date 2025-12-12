import type { ElevenLabsTtsUnifiedParams, TtsBlockResponse } from '@/tools/tts/types'
import type { ToolConfig } from '@/tools/types'

export const elevenLabsTtsUnifiedTool: ToolConfig<ElevenLabsTtsUnifiedParams, TtsBlockResponse> = {
  id: 'tts_elevenlabs',
  name: 'ElevenLabs TTS',
  description: 'Convert text to speech using ElevenLabs voices',
  version: '1.0.0',

  params: {
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The text to convert to speech',
    },
    voiceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the voice to use',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ElevenLabs API key',
    },
    modelId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Model to use (e.g., eleven_monolingual_v1, eleven_turbo_v2_5, eleven_flash_v2_5)',
    },
    stability: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Voice stability (0.0 to 1.0, default: 0.5)',
    },
    similarityBoost: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Similarity boost (0.0 to 1.0, default: 0.8)',
    },
    style: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Style exaggeration (0.0 to 1.0)',
    },
    useSpeakerBoost: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Use speaker boost (default: true)',
    },
  },

  request: {
    url: '/api/proxy/tts/unified',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (
      params: ElevenLabsTtsUnifiedParams & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
      }
    ) => ({
      provider: 'elevenlabs',
      text: params.text,
      apiKey: params.apiKey,
      voiceId: params.voiceId,
      modelId: params.modelId || 'eleven_turbo_v2_5',
      stability: params.stability ?? 0.5,
      similarityBoost: params.similarityBoost ?? 0.8,
      style: params.style,
      useSpeakerBoost: params.useSpeakerBoost ?? true,
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
        error: data.error || 'TTS generation failed',
        output: {
          audioUrl: '',
        },
      }
    }

    return {
      success: true,
      output: {
        audioUrl: data.audioUrl,
        audioFile: data.audioFile,
        duration: data.duration,
        characterCount: data.characterCount,
        format: data.format,
        provider: data.provider,
      },
    }
  },

  outputs: {
    audioUrl: { type: 'string', description: 'URL to the generated audio file' },
    audioFile: { type: 'file', description: 'Generated audio file object' },
    duration: { type: 'number', description: 'Audio duration in seconds' },
    characterCount: { type: 'number', description: 'Number of characters processed' },
    format: { type: 'string', description: 'Audio format' },
    provider: { type: 'string', description: 'TTS provider used' },
  },
}
