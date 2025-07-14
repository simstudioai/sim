import { ElevenLabsIcon } from '@/components/icons'
import type { ToolResponse } from '@/tools/types'
import type { BlockConfig } from '../types'

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
  docsLink: 'https://docs.simstudio.ai/tools/elevenlabs',
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
    text: { type: 'string', required: true },
    voiceId: { type: 'string', required: true },
    modelId: { type: 'string', required: false },
    apiKey: { type: 'string', required: true },
  },

  outputs: {
    audioUrl: 'string',
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
      id: 'modelId',
      title: 'Model ID',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'eleven_monolingual_v1', id: 'eleven_monolingual_v1' },
        { label: 'eleven_multilingual_v2', id: 'eleven_multilingual_v2' },
        { label: 'eleven_turbo_v2', id: 'eleven_turbo_v2' },
        { label: 'eleven_turbo_v2_5', id: 'eleven_turbo_v2_5' },
        { label: 'eleven_flash_v2_5', id: 'eleven_flash_v2_5' },
      ],
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your ElevenLabs API key',
      password: true,
    },
  ],
}
