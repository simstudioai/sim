import { EyeIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { VisionResponse } from '@/tools/vision/types'

export const VisionBlock: BlockConfig<VisionResponse> = {
  type: 'vision',
  name: 'Vision',
  description: 'Analyze images with vision models',
  longDescription:
    'Integrate Vision into the workflow. Can analyze images with vision models. Requires API Key.',
  docsLink: 'https://docs.sim.ai/tools/vision',
  category: 'tools',
  bgColor: '#4D5FFF',
  icon: EyeIcon,
  subBlocks: [
    {
      id: 'imageUrl',
      title: 'Image URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter publicly accessible image URL',
      required: true,
    },
    {
      id: 'model',
      title: 'Vision Model',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'gpt-4o', id: 'gpt-4o' },
        { label: 'claude-3-opus', id: 'claude-3-opus-20240229' },
        { label: 'claude-3-sonnet', id: 'claude-3-sonnet-20240229' },
      ],
      value: () => 'gpt-4o',
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter prompt for image analysis',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['vision_tool'],
  },
  inputs: {
    apiKey: { type: 'string', description: 'Provider API key' },
    imageUrl: { type: 'string', description: 'Image URL' },
    model: { type: 'string', description: 'Vision model' },
    prompt: { type: 'string', description: 'Analysis prompt' },
  },
  outputs: {
    content: { type: 'string', description: 'Analysis result' },
    model: { type: 'string', description: 'Model used' },
    tokens: { type: 'number', description: 'Token usage' },
  },
}
