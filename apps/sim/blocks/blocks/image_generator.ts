import { ImageIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { DalleResponse } from '@/tools/openai/types'

export const ImageGeneratorBlock: BlockConfig<DalleResponse> = {
  type: 'image_generator',
  name: 'Image Generator',
  description: 'Generate images',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Image Generator into the workflow. Can generate images using DALL-E 3, GPT Image (OpenAI), or Flux and other community models via ModelsLab.',
  docsLink: 'https://docs.sim.ai/tools/image_generator',
  category: 'tools',
  bgColor: '#4D5FFF',
  icon: ImageIcon,
  subBlocks: [
    // Provider selection
    {
      id: 'provider',
      title: 'Provider',
      type: 'dropdown',
      options: [
        { label: 'OpenAI', id: 'openai' },
        { label: 'ModelsLab', id: 'modelslab' },
      ],
      value: () => 'openai',
    },

    // OpenAI model selection
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      options: [
        { label: 'DALL-E 3', id: 'dall-e-3' },
        { label: 'GPT Image', id: 'gpt-image-1' },
      ],
      value: () => 'dall-e-3',
      condition: { field: 'provider', value: 'openai' },
    },

    // ModelsLab model selection
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      options: [
        { label: 'Flux (Schnell)', id: 'flux' },
        { label: 'Juggernaut XL', id: 'juggernaut-xl-v10' },
        { label: 'RealVisXL v5', id: 'realvisxlV50_v50Bakedvae' },
        { label: 'DreamShaper XL', id: 'dreamshaperXL10_alpha2Xl10' },
        { label: 'Stable Diffusion XL', id: 'sdxl' },
      ],
      value: () => 'flux',
      condition: { field: 'provider', value: 'modelslab' },
    },

    // Prompt — always shown
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      required: true,
      placeholder: 'Describe the image you want to generate...',
    },

    // === OpenAI options ===

    // Size for DALL-E 3
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
      condition: { field: 'provider', value: 'openai', and: { field: 'model', value: 'dall-e-3' } },
    },

    // Size for GPT Image
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
        and: { field: 'model', value: 'gpt-image-1' },
      },
    },

    // Quality (DALL-E 3 only)
    {
      id: 'quality',
      title: 'Quality',
      type: 'dropdown',
      options: [
        { label: 'Standard', id: 'standard' },
        { label: 'HD', id: 'hd' },
      ],
      value: () => 'standard',
      condition: { field: 'provider', value: 'openai', and: { field: 'model', value: 'dall-e-3' } },
    },

    // Style (DALL-E 3 only)
    {
      id: 'style',
      title: 'Style',
      type: 'dropdown',
      options: [
        { label: 'Vivid', id: 'vivid' },
        { label: 'Natural', id: 'natural' },
      ],
      value: () => 'vivid',
      condition: { field: 'provider', value: 'openai', and: { field: 'model', value: 'dall-e-3' } },
    },

    // Background (GPT Image only)
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
        and: { field: 'model', value: 'gpt-image-1' },
      },
    },

    // === ModelsLab options ===

    // Size for ModelsLab
    {
      id: 'size',
      title: 'Size',
      type: 'dropdown',
      options: [
        { label: '512×512', id: '512x512' },
        { label: '768×768', id: '768x768' },
        { label: '1024×1024', id: '1024x1024' },
        { label: '1024×768 (landscape)', id: '1024x768' },
        { label: '768×1024 (portrait)', id: '768x1024' },
        { label: '1344×768 (wide)', id: '1344x768' },
      ],
      value: () => '1024x1024',
      condition: { field: 'provider', value: 'modelslab' },
    },

    // Negative prompt for ModelsLab
    {
      id: 'negativePrompt',
      title: 'Negative Prompt',
      type: 'long-input',
      placeholder: 'What to exclude from the image (e.g. blurry, low quality)...',
      condition: { field: 'provider', value: 'modelslab' },
    },

    // API Key — always shown
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your API key',
      password: true,
      connectionDroppable: false,
    },
  ],
  tools: {
    access: ['openai_image', 'image_modelslab'],
    config: {
      tool: (params) => (params.provider === 'modelslab' ? 'image_modelslab' : 'openai_image'),
      params: (params) => {
        if (!params.apiKey) {
          throw new Error('API key is required')
        }
        if (!params.prompt) {
          throw new Error('Prompt is required')
        }

        const provider = params.provider || 'openai'

        if (provider === 'modelslab') {
          // Parse size string (e.g. "1024x768") into width/height
          const sizeStr = String(params.size || '1024x1024')
          const [widthStr, heightStr] = sizeStr.split('x')
          const width = parseInt(widthStr, 10) || 1024
          const height = parseInt(heightStr, 10) || 1024

          return {
            provider: 'modelslab',
            apiKey: params.apiKey,
            model: params.model || 'flux',
            prompt: params.prompt,
            width,
            height,
            negativePrompt: params.negativePrompt,
          }
        }

        // OpenAI (default)
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
    provider: { type: 'string', description: 'Image generation provider (openai or modelslab)' },
    model: { type: 'string', description: 'Image generation model' },
    size: { type: 'string', description: 'Image dimensions' },
    quality: { type: 'string', description: 'Image quality level (OpenAI DALL-E 3)' },
    style: { type: 'string', description: 'Image style (OpenAI DALL-E 3)' },
    background: { type: 'string', description: 'Background type (OpenAI GPT Image)' },
    negativePrompt: { type: 'string', description: 'Negative prompt (ModelsLab)' },
    apiKey: { type: 'string', description: 'API key for the selected provider' },
  },
  outputs: {
    content: { type: 'string', description: 'Generation response' },
    image: { type: 'file', description: 'Generated image file (UserFile)' },
    metadata: { type: 'json', description: 'Generation metadata' },
  },
}
