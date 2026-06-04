import { ElevenLabsIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, IntegrationType } from '@/blocks/types'
import type { ElevenLabsBlockResponse } from '@/tools/elevenlabs/types'

export const ElevenLabsBlock: BlockConfig<ElevenLabsBlockResponse> = {
  type: 'elevenlabs',
  name: 'ElevenLabs',
  description: 'Convert text to speech with ElevenLabs',
  authMode: AuthMode.ApiKey,
  longDescription: 'Integrate ElevenLabs into the workflow. Can convert text to speech.',
  docsLink: 'https://docs.sim.ai/tools/elevenlabs',
  category: 'tools',
  integrationType: IntegrationType.AI,
  tags: ['text-to-speech'],
  bgColor: '#181C1E',
  icon: ElevenLabsIcon,

  subBlocks: [
    {
      id: 'text',
      title: 'Text',
      type: 'long-input',
      placeholder: 'Enter the text to convert to speech',
      required: true,
    },
    {
      id: 'voiceId',
      title: 'Voice ID',
      type: 'short-input',
      placeholder: 'Enter the voice ID',
      required: true,
    },
    {
      id: 'modelId',
      title: 'Model ID',
      type: 'dropdown',
      options: [
        { label: 'eleven_monolingual_v1', id: 'eleven_monolingual_v1' },
        { label: 'eleven_multilingual_v2', id: 'eleven_multilingual_v2' },
        { label: 'eleven_turbo_v2', id: 'eleven_turbo_v2' },
        { label: 'eleven_turbo_v2_5', id: 'eleven_turbo_v2_5' },
        { label: 'eleven_flash_v2_5', id: 'eleven_flash_v2_5' },
        { label: 'eleven_v3', id: 'eleven_v3' },
      ],
      value: () => 'eleven_monolingual_v1',
    },
    {
      id: 'stability',
      title: 'Stability',
      type: 'short-input',
      placeholder: '0.0 to 1.0 (e.g., 0.5)',
      mode: 'advanced',
    },
    {
      id: 'similarityBoost',
      title: 'Similarity Boost',
      type: 'short-input',
      placeholder: '0.0 to 1.0 (e.g., 0.75)',
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your ElevenLabs API key',
      password: true,
      required: true,
    },
  ],

  tools: {
    access: ['elevenlabs_tts'],
    config: {
      tool: () => 'elevenlabs_tts',
      params: (params) => {
        const parseUnitInterval = (value: unknown): number | undefined => {
          if (value === undefined || value === null || value === '') return undefined
          const n = Number(value)
          return Number.isFinite(n) ? n : undefined
        }
        return {
          apiKey: params.apiKey,
          text: params.text,
          voiceId: params.voiceId,
          modelId: params.modelId,
          stability: parseUnitInterval(params.stability),
          similarityBoost: parseUnitInterval(params.similarityBoost),
        }
      },
    },
  },

  inputs: {
    text: { type: 'string', description: 'Text to convert' },
    voiceId: { type: 'string', description: 'Voice identifier' },
    modelId: { type: 'string', description: 'Model identifier' },
    stability: { type: 'number', description: 'Voice stability 0.0-1.0' },
    similarityBoost: { type: 'number', description: 'Similarity boost 0.0-1.0' },
    apiKey: { type: 'string', description: 'ElevenLabs API key' },
  },

  outputs: {
    audioUrl: { type: 'string', description: 'Generated audio URL' },
    audioFile: { type: 'file', description: 'Generated audio file' },
  },
}
