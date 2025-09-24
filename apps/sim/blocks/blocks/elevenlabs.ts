import { ElevenLabsIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { ElevenLabsBlockResponse } from '@/tools/elevenlabs/types'

export const ElevenLabsBlock: BlockConfig<ElevenLabsBlockResponse> = {
  type: 'elevenlabs',
  name: 'ElevenLabs',
  description: 'Convert TTS using ElevenLabs',
  authMode: AuthMode.ApiKey,
  longDescription: 'Integrate ElevenLabs into the workflow. Can convert text to speech.',
  docsLink: 'https://docs.sim.ai/tools/elevenlabs',
  category: 'tools',
  bgColor: '#181C1E',
  icon: ElevenLabsIcon,

  subBlocks: [
    {
      id: 'text',
      title: 'Text',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter the text to convert to speech',
      required: true,
    },
    {
      id: 'voiceId',
      title: 'Voice ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter the voice ID',
      required: true,
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
      required: true,
    },
  ],

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
    text: { type: 'string', description: 'Text to convert' },
    voiceId: { type: 'string', description: 'Voice identifier' },
    modelId: { type: 'string', description: 'Model identifier' },
    apiKey: { type: 'string', description: 'ElevenLabs API key' },
  },

  outputs: {
    audioUrl: { type: 'string', description: 'Generated audio URL' },
  },
}
