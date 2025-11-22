import type { DeepgramTtsParams, TtsBlockResponse } from '@/tools/tts/types'
import type { ToolConfig } from '@/tools/types'

export const deepgramTtsTool: ToolConfig<DeepgramTtsParams, TtsBlockResponse> = {
  id: 'tts_deepgram',
  name: 'Deepgram TTS',
  description: 'Convert text to speech using Deepgram Aura',
  version: '1.0.0',

  params: {
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The text to convert to speech',
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
      visibility: 'user-only',
      description: 'Deepgram model/voice (e.g., aura-asteria-en, aura-luna-en)',
    },
    voice: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Voice identifier (alternative to model param)',
    },
    encoding: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Audio encoding (linear16, mp3, opus, aac, flac)',
    },
    sampleRate: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Sample rate (8000, 16000, 24000, 48000)',
    },
    bitRate: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Bit rate for compressed formats',
    },
    container: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Container format (none, wav, ogg)',
    },
  },

  request: {
    url: '/api/proxy/tts/unified',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (
      params: DeepgramTtsParams & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
      }
    ) => ({
      provider: 'deepgram',
      text: params.text,
      apiKey: params.apiKey,
      model: params.model || params.voice || 'aura-asteria-en',
      encoding: params.encoding || 'mp3',
      sampleRate: params.sampleRate,
      bitRate: params.bitRate,
      container: params.container || 'none',
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
