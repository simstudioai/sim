import { createLogger } from '@/lib/logs/console-logger'
import type { ToolConfig } from '../types'
import type { ElevenLabsTtsParams, ElevenLabsTtsResponse } from './types'

const logger = createLogger('ElevenLabsTool')

export const elevenLabsTtsTool: ToolConfig<ElevenLabsTtsParams, ElevenLabsTtsResponse> = {
  id: 'elevenlabs_tts',
  name: 'ElevenLabs TTS',
  description: 'Convert TTS using ElevenLabs voices',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      description: 'Your ElevenLabs API key',
      requiredForToolCall: true,
    },
    text: {
      type: 'string',
      required: true,
      description: 'The text to convert to speech',
    },
    voiceId: {
      type: 'string',
      required: true,
      description: 'The ID of the voice to use',
      requiredForToolCall: true,
    },
    modelId: {
      type: 'string',
      required: false,
      description: 'The ID of the model to use (defaults to eleven_monolingual_v1)',
    },
  },

  request: {
    url: '/api/proxy/tts',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      apiKey: params.apiKey,
      text: params.text,
      voiceId: params.voiceId,
      modelId: params.modelId || 'eleven_monolingual_v1',
    }),
    isInternalRoute: true,
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        audioUrl: data.audioUrl,
      },
    }
  },

  transformError: (error) => {
    logger.error('ElevenLabs TTS error:', error)
    return `Error generating speech: ${error instanceof Error ? error.message : String(error)}`
  },
}
