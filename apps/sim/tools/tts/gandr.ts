import type { GandrTtsParams, TtsBlockResponse } from '@/tools/tts/types'
import type { InternalToolConfig } from '@/tools/types'

export const gandrTtsTool: InternalToolConfig<GandrTtsParams, TtsBlockResponse> = {
  id: 'tts_gandr',
  name: 'Gandr TTS',
  description: 'Convert text to speech using Gandr voices',
  version: '1.0.0',

  params: {
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The text content to convert to speech, up to 2000 characters per request (e.g., "Hello, welcome to our service!")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gandr API key',
    },
    voice: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Gandr voice identifier (e.g., "gandr-mia", "gandr-ava", "gandr-jenny", "gandr-dane", "gandr-leo", "gandr-lewis")',
    },
    responseFormat: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Audio format (mp3, wav, pcm)',
    },
  },

  operation: {
    modelInput: {
      mode: 'project',
      select: (params) => ({ text: params.text }),
    },
    input: (params) => ({
      text: params.text,
      apiKey: params.apiKey,
      voice: params.voice || 'gandr-mia',
      responseFormat: params.responseFormat || 'mp3',
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
