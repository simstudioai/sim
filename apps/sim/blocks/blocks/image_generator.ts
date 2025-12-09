import { ImageIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { ImageResponse } from '@/tools/image/types'

export const ImageGeneratorBlock: BlockConfig<ImageResponse> = {
  type: 'image_generator',
  name: 'Image Generator',
  description: 'Generate images',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Image Generator into the workflow. Generate images using OpenAI (DALL-E 3, GPT Image) or Fal.ai models.',
  docsLink: 'https://docs.sim.ai/tools/image_generator',
  category: 'tools',
  bgColor: '#4D5FFF',
  icon: ImageIcon,
  subBlocks: [
    {
      id: 'provider',
      title: 'Provider',
      type: 'dropdown',
      options: [
        { label: 'OpenAI', id: 'openai' },
        { label: 'Fal.ai', id: 'falai' },
      ],
      value: () => 'openai',
      required: true,
    },

    {
      id: 'openaiModel',
      title: 'Model',
      type: 'dropdown',
      options: [
        { label: 'DALL-E 3', id: 'dall-e-3' },
        { label: 'GPT Image', id: 'gpt-image-1' },
      ],
      value: () => 'dall-e-3',
      condition: { field: 'provider', value: 'openai' },
    },

    {
      id: 'falaiModel',
      title: 'Model',
      type: 'short-input',
      placeholder: 'e.g., fal-ai/flux/schnell',
      condition: { field: 'provider', value: 'falai' },
    },

    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      required: true,
      placeholder: 'Describe the image you want to generate...',
    },

    {
      id: 'size',
      title: 'Size',
      type: 'dropdown',
      options: [
        { label: '1024x1024', id: '1024x1024' },
        { label: '1024x1792', id: '1024x1792' },
        { label: '1792x1024', id: '1792x1024' },
      ],
      value: () => '1024x1024',
      condition: {
        field: 'provider',
        value: 'openai',
        and: { field: 'openaiModel', value: 'dall-e-3' },
      },
    },

    {
      id: 'size',
      title: 'Size',
      type: 'dropdown',
      options: [
        { label: 'Auto', id: 'auto' },
        { label: '1024x1024', id: '1024x1024' },
        { label: '1536x1024', id: '1536x1024' },
        { label: '1024x1536', id: '1024x1536' },
      ],
      value: () => 'auto',
      condition: {
        field: 'provider',
        value: 'openai',
        and: { field: 'openaiModel', value: 'gpt-image-1' },
      },
    },

    {
      id: 'size',
      title: 'Size',
      type: 'dropdown',
      options: [
        { label: 'Square HD (1024x1024)', id: 'square_hd' },
        { label: 'Square (512x512)', id: 'square' },
        { label: 'Portrait 4:3', id: 'portrait_4_3' },
        { label: 'Portrait 16:9', id: 'portrait_16_9' },
        { label: 'Landscape 4:3', id: 'landscape_4_3' },
        { label: 'Landscape 16:9', id: 'landscape_16_9' },
      ],
      value: () => 'square_hd',
      condition: { field: 'provider', value: 'falai' },
    },

    {
      id: 'quality',
      title: 'Quality',
      type: 'dropdown',
      options: [
        { label: 'Standard', id: 'standard' },
        { label: 'HD', id: 'hd' },
      ],
      value: () => 'standard',
      condition: {
        field: 'provider',
        value: 'openai',
        and: { field: 'openaiModel', value: 'dall-e-3' },
      },
    },

    {
      id: 'style',
      title: 'Style',
      type: 'dropdown',
      options: [
        { label: 'Vivid', id: 'vivid' },
        { label: 'Natural', id: 'natural' },
      ],
      value: () => 'vivid',
      condition: {
        field: 'provider',
        value: 'openai',
        and: { field: 'openaiModel', value: 'dall-e-3' },
      },
    },

    {
      id: 'background',
      title: 'Background',
      type: 'dropdown',
      options: [
        { label: 'Auto', id: 'auto' },
        { label: 'Transparent', id: 'transparent' },
        { label: 'Opaque', id: 'opaque' },
      ],
      value: () => 'auto',
      condition: {
        field: 'provider',
        value: 'openai',
        and: { field: 'openaiModel', value: 'gpt-image-1' },
      },
    },

    {
      id: 'numInferenceSteps',
      title: 'Inference Steps',
      type: 'dropdown',
      options: [
        { label: '1 (Fastest)', id: '1' },
        { label: '4 (Default)', id: '4' },
        { label: '8', id: '8' },
        { label: '20', id: '20' },
        { label: '50 (Highest Quality)', id: '50' },
      ],
      value: () => '4',
      condition: { field: 'provider', value: 'falai' },
    },

    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your provider API key',
      password: true,
      connectionDroppable: false,
    },
  ],
  tools: {
    access: ['openai_image', 'falai_image'],
    config: {
      tool: (params) => {
        switch (params.provider) {
          case 'falai':
            return 'falai_image'
          case 'openai':
          default:
            return 'openai_image'
        }
      },
      params: (params) => {
        if (!params.apiKey) {
          throw new Error('API key is required')
        }
        if (!params.prompt) {
          throw new Error('Prompt is required')
        }

        if (params.provider === 'falai') {
          return {
            provider: 'falai',
            apiKey: params.apiKey,
            model: params.falaiModel || 'flux-schnell',
            prompt: params.prompt,
            size: params.size || 'square_hd',
            numInferenceSteps: params.numInferenceSteps
              ? Number(params.numInferenceSteps)
              : undefined,
          }
        }

        const baseParams = {
          prompt: params.prompt,
          model: params.openaiModel || 'dall-e-3',
          size: params.size || '1024x1024',
          apiKey: params.apiKey,
        }

        if (params.openaiModel === 'dall-e-3') {
          return {
            ...baseParams,
            quality: params.quality || 'standard',
            style: params.style || 'vivid',
          }
        }
        if (params.openaiModel === 'gpt-image-1') {
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
    provider: { type: 'string', description: 'Image generation provider (openai, falai)' },
    prompt: { type: 'string', description: 'Image description prompt' },
    openaiModel: { type: 'string', description: 'Image generation model' },
    falaiModel: { type: 'string', description: 'Image generation model' },
    size: { type: 'string', description: 'Image dimensions' },
    quality: { type: 'string', description: 'Image quality level' },
    style: { type: 'string', description: 'Image style' },
    background: { type: 'string', description: 'Background type' },
    numInferenceSteps: { type: 'number', description: 'Inference steps' },
    apiKey: { type: 'string', description: 'Provider API key' },
  },
  outputs: {
    content: { type: 'string', description: 'Generation response' },
    image: { type: 'string', description: 'Generated image URL' },
    metadata: { type: 'json', description: 'Generation metadata' },
  },
}
