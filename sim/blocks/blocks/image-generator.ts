import { ImageIcon } from '@/components/icons'
import { DalleResponse } from '@/tools/openai/dalle'
import { BlockConfig } from '../types'

export const ImageGeneratorBlock: BlockConfig<DalleResponse> = {
  type: 'image_generator',
  name: 'Image Generator',
  description: 'Generate images',
  longDescription:
    'Create high-quality images using DALL-E. Configure resolution, quality, style, and other parameters to get exactly the image you need.',
  category: 'tools',
  bgColor: '#4D5FFF',
  icon: ImageIcon,
  subBlocks: [
    {
      id: 'provider',
      title: 'Provider',
      type: 'dropdown',
      layout: 'full',
      options: [{ label: 'DALL-E', id: 'dalle' }],
      value: () => 'dalle',
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Describe the image you want to generate...',
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'DALL-E 2', id: 'dall-e-2' },
        { label: 'DALL-E 3', id: 'dall-e-3' },
      ],
      value: () => 'dall-e-3',
    },
    {
      id: 'size',
      title: 'Size',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: '1024x1024', id: '1024x1024' },
        { label: '1024x1792', id: '1024x1792' },
        { label: '1792x1024', id: '1792x1024' },
      ],
      value: () => '1024x1024',
    },
    {
      id: 'quality',
      title: 'Quality',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Standard', id: 'standard' },
        { label: 'HD', id: 'hd' },
      ],
      value: () => 'standard',
    },
    {
      id: 'style',
      title: 'Style',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Vivid', id: 'vivid' },
        { label: 'Natural', id: 'natural' },
      ],
      value: () => 'vivid',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your OpenAI API key',
      password: true,
      connectionDroppable: false,
    },
  ],
  tools: {
    access: ['dalle_generate'],
    config: {
      tool: () => 'dalle_generate',
      params: (params) => {
        if (!params.apiKey) {
          throw new Error('API key is required')
        }
        if (!params.prompt) {
          throw new Error('Prompt is required')
        }

        return {
          prompt: params.prompt,
          model: params.model || 'dall-e-3',
          size: params.size || '1024x1024',
          quality: params.quality || 'standard',
          style: params.style || 'vivid',
          apiKey: params.apiKey,
        }
      },
    },
  },
  inputs: {
    provider: { type: 'string', required: true },
    prompt: { type: 'string', required: true },
    model: { type: 'string', required: true },
    size: { type: 'string', required: false },
    quality: { type: 'string', required: false },
    style: { type: 'string', required: false },
    apiKey: { type: 'string', required: true },
  },
  outputs: {
    response: {
      type: {
        content: 'string', // URL of the generated image
        image: 'string', // Base64 image data
        metadata: 'json', // Contains only model information
      },
    },
  },
}
