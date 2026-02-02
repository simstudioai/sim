import type { OpenAiTtsParams, TtsBlockResponse } from '@/tools/tts/types'
import type { ToolConfig } from '@/tools/types'

export const openaiTtsTool: ToolConfig<OpenAiTtsParams, TtsBlockResponse> = {
  id: 'tts_openai',
  name: 'OpenAI TTS',
  description: 'Convert text to speech using OpenAI TTS models',
  version: '1.0.0',

  params: {
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The text content to convert to speech (e.g., "Hello, welcome to our service!")',
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
      description: 'OpenAI TTS model identifier (e.g., "tts-1", "tts-1-hd", "gpt-4o-mini-tts")',
    },
    voice: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'OpenAI voice identifier (e.g., "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer")',
    },
    responseFormat: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Audio format (mp3, opus, aac, flac, wav, pcm)',
    },
    speed: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Speech speed multiplier from 0.25 to 4.0 (e.g., 0.5 for slower, 1.0 for normal, 2.0 for faster)',
    },
  },

  request: {
    url: '/api/tools/tts/unified',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (
      params: OpenAiTtsParams & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
      }
    ) => ({
      provider: 'openai',
      text: params.text,
      apiKey: params.apiKey,
      model: params.model || 'tts-1',
      voice: params.voice || 'alloy',
      responseFormat: params.responseFormat || 'mp3',
      speed: params.speed || 1.0,
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
