import { ImageIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { DalleResponse } from '@/tools/openai/types'

export const ImageGeneratorBlock: BlockConfig<DalleResponse> = {
  type: 'image_generator',
  name: 'Image Generator',
  description: 'Generate images',
  longDescription:
    'Integrate Image Generator into the workflow. Can generate images using DALL-E 3 or GPT Image. Requires API Key.',
  docsLink: 'https://docs.sim.ai/tools/image_generator',
  category: 'tools',
  bgColor: '#4D5FFF',
  icon: ImageIcon,
  subBlocks: [
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'DALL-E 3', id: 'dall-e-3' },
        { label: 'GPT Image', id: 'gpt-image-1' },
      ],
      value: () => 'dall-e-3',
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      layout: 'full',
      required: true,
      placeholder: 'Describe the image you want to generate...',
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
      condition: { field: 'model', value: 'dall-e-3' },
    },
    {
      id: 'size',
      title: 'Size',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Auto', id: 'auto' },
        { label: '1024x1024', id: '1024x1024' },
        { label: '1536x1024', id: '1536x1024' },
        { label: '1024x1536', id: '1024x1536' },
      ],
      value: () => 'auto',
      condition: { field: 'model', value: 'gpt-image-1' },
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
      condition: { field: 'model', value: 'dall-e-3' },
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
      condition: { field: 'model', value: 'dall-e-3' },
    },
    {
      id: 'background',
      title: 'Background',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Auto', id: 'auto' },
        { label: 'Transparent', id: 'transparent' },
        { label: 'Opaque', id: 'opaque' },
      ],
      value: () => 'auto',
      condition: { field: 'model', value: 'gpt-image-1' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter your OpenAI API key',
      password: true,
      connectionDroppable: false,
    },
  ],
  tools: {
    access: ['openai_image'],
    config: {
      tool: () => 'openai_image',
      params: (params) => {
        if (!params.apiKey) {
          throw new Error('API key is required')
        }
        if (!params.prompt) {
          throw new Error('Prompt is required')
        }

        // Base parameters for all models
        const baseParams = {
          prompt: params.prompt,
          model: params.model || 'dall-e-3',
          size: params.size || '1024x1024',
          apiKey: params.apiKey,
        }

        if (params.model === 'dall-e-3') {
          return {
            ...baseParams,
            quality: params.quality || 'standard',
            style: params.style || 'vivid',
          }
        }
        if (params.model === 'gpt-image-1') {
          return {
            ...baseParams,
            ...(params.background && { background: params.background }),
          }
        }

        return baseParams
      },
    },
  },
  inputs: {
    prompt: { type: 'string', description: 'Image description prompt' },
    model: { type: 'string', description: 'Image generation model' },
    size: { type: 'string', description: 'Image dimensions' },
    quality: { type: 'string', description: 'Image quality level' },
    style: { type: 'string', description: 'Image style' },
    background: { type: 'string', description: 'Background type' },
    apiKey: { type: 'string', description: 'OpenAI API key' },
  },
  outputs: {
    content: { type: 'string', description: 'Generation response' },
    image: { type: 'string', description: 'Generated image URL' },
    metadata: { type: 'json', description: 'Generation metadata' },
  },
}
