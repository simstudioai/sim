import type { GoogleTtsParams, TtsBlockResponse } from '@/tools/tts/types'
import type { ToolConfig } from '@/tools/types'

export const googleTtsTool: ToolConfig<GoogleTtsParams, TtsBlockResponse> = {
  id: 'tts_google',
  name: 'Google Cloud TTS',
  description: 'Convert text to speech using Google Cloud Text-to-Speech',
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
      description: 'Google Cloud API key',
    },
    voiceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Google Cloud voice identifier (e.g., "en-US-Neural2-A", "en-US-Wavenet-D", "en-GB-Neural2-B")',
    },
    languageCode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'BCP-47 language code for speech synthesis (e.g., "en-US", "es-ES", "fr-FR", "de-DE")',
    },
    gender: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Voice gender (MALE, FEMALE, NEUTRAL)',
    },
    audioEncoding: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Audio encoding (LINEAR16, MP3, OGG_OPUS, MULAW, ALAW)',
    },
    speakingRate: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Speaking rate multiplier from 0.25 to 2.0 (e.g., 0.5 for slower, 1.0 for normal, 1.5 for faster)',
    },
    pitch: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Voice pitch (-20.0 to 20.0, default: 0.0)',
    },
    volumeGainDb: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Volume gain in dB (-96.0 to 16.0)',
    },
    sampleRateHertz: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Sample rate in Hz',
    },
    effectsProfileId: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description: "Effects profile (e.g., ['headphone-class-device'])",
    },
  },

  request: {
    url: '/api/tools/tts/unified',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (
      params: GoogleTtsParams & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
      }
    ) => ({
      provider: 'google',
      text: params.text,
      apiKey: params.apiKey,
      voiceId: params.voiceId,
      languageCode: params.languageCode,
      gender: params.gender,
      audioEncoding: params.audioEncoding || 'MP3',
      speakingRate: params.speakingRate ?? 1.0,
      pitch: params.pitch ?? 0.0,
      volumeGainDb: params.volumeGainDb,
      sampleRateHertz: params.sampleRateHertz,
      effectsProfileId: params.effectsProfileId,
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
