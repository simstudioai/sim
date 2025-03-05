import { CrewAIIcon } from '@/components/icons'
import { VisionResponse } from '@/tools/crewai/vision'
import { BlockConfig } from '../types'

export const CrewAIVisionBlock: BlockConfig<VisionResponse> = {
  type: 'crewai_vision',
  name: 'CrewAI Vision',
  description: 'Analyze images with vision models',
  longDescription:
    'Process visual content with customizable prompts to extract insights and information from images.',
  category: 'tools',
  bgColor: '#FF5A50',
  icon: CrewAIIcon,
  subBlocks: [
    {
      id: 'imageUrl',
      title: 'Image URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter publicly accessible image URL',
    },
    {
      id: 'model',
      title: 'Vision Model',
      type: 'dropdown',
      layout: 'half',
      options: ['gpt-4o', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229'],
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter prompt for image analysis (optional)',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your API key',
      password: true,
    },
  ],
  tools: {
    access: ['crewai_vision'],
  },
  inputs: {
    apiKey: { type: 'string', required: true },
    imageUrl: { type: 'string', required: true },
    model: { type: 'string', required: false },
    prompt: { type: 'string', required: false },
  },
  outputs: {
    response: {
      type: {
        content: 'string',
        model: 'any',
        tokens: 'any',
      },
    },
  },
}
