import type { AzureTtsParams, TtsBlockResponse } from '@/tools/tts/types'
import type { ToolConfig } from '@/tools/types'

export const azureTtsTool: ToolConfig<AzureTtsParams, TtsBlockResponse> = {
  id: 'tts_azure',
  name: 'Azure TTS',
  description: 'Convert text to speech using Azure Cognitive Services',
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
      description: 'Azure Speech Services API key',
    },
    voiceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Voice ID (e.g., en-US-JennyNeural, en-US-GuyNeural)',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Azure region (e.g., eastus, westus, westeurope)',
    },
    outputFormat: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Output audio format',
    },
    rate: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Speaking rate (e.g., +10%, -20%, 1.5)',
    },
    pitch: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Voice pitch (e.g., +5Hz, -2st, low)',
    },
    style: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Speaking style (e.g., cheerful, sad, angry - neural voices only)',
    },
    styleDegree: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Style intensity (0.01 to 2.0)',
    },
    role: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Role (e.g., Girl, Boy, YoungAdultFemale)',
    },
  },

  request: {
    url: '/api/proxy/tts/unified',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (
      params: AzureTtsParams & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
      }
    ) => ({
      provider: 'azure',
      text: params.text,
      apiKey: params.apiKey,
      voiceId: params.voiceId || 'en-US-JennyNeural',
      region: params.region || 'eastus',
      outputFormat: params.outputFormat || 'audio-24khz-96kbitrate-mono-mp3',
      rate: params.rate,
      pitch: params.pitch,
      style: params.style,
      styleDegree: params.styleDegree,
      role: params.role,
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
