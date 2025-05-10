import { ElevenLabsIcon } from '@/components/icons'
import { ToolResponse } from '@/tools/types'
import { BlockConfig } from '../types'

interface ElevenLabsBlockResponse extends ToolResponse {
  output: {
    audioUrl: string
  }
}

export const ElevenLabsBlock: BlockConfig<ElevenLabsBlockResponse> = {
  type: 'elevenlabs',
  name: 'ElevenLabs',
  description: 'Convert TTS using ElevenLabs',
  longDescription: 'Generate realistic speech from text using ElevenLabs voices.',
  category: 'tools',
  bgColor: '#181C1E',
  icon: ElevenLabsIcon,

  tools: {
    access: ['elevenlabs_tts'],
    config: {
      tool: () => 'elevenlabs_tts',
      params: (params) => ({
        apiKey: params.apiKey,
        text: params.text,
        voiceId: params.voiceId,
        modelId: params.modelId,
      }),
    },
  },

  inputs: {
    text: {
      type: 'string',
      required: true,
    },
    voiceId: {
      type: 'string',
      required: true,
    },
    modelId: {
      type: 'string',
      required: false,
    },
    apiKey: {
      type: 'string',
      required: true,
    },
  },

  outputs: {
    response: {
      type: {
        audioUrl: 'string',
      },
    },
  },

  subBlocks: [
    {
      id: 'text',
      title: 'Text',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter the text to convert to speech',
    },
    {
      id: 'voiceId',
      title: 'Voice ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter the voice ID',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your ElevenLabs API key',
      password: true,
    },
    {
      id: 'modelId',
      title: 'Model ID (Optional)',
      type: 'dropdown',
      layout: 'half',
      options: [
        'eleven_monolingual_v1',
        'eleven_multilingual_v2',
        'eleven_turbo_v2',
        'eleven_turbo_v2_5',
        'eleven_flash_v2_5',
      ],
    },
  ],
}
