import { ImageIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, IntegrationType } from '@/blocks/types'
import { parseOptionalBooleanInput } from '@/blocks/utils'
import type { ImageGenerationResponse } from '@/tools/image/types'
import type { DalleResponse } from '@/tools/openai/types'

const OPENAI_GPT_IMAGE_MODELS = [
  { label: 'GPT Image 1.5', id: 'gpt-image-1.5' },
  { label: 'GPT Image 1', id: 'gpt-image-1' },
  { label: 'GPT Image 1 Mini', id: 'gpt-image-1-mini' },
]

const GEMINI_IMAGE_MODELS = [
  { label: 'Nano Banana 2', id: 'gemini-3.1-flash-image-preview' },
  { label: 'Nano Banana Pro', id: 'gemini-3-pro-image-preview' },
  { label: 'Nano Banana', id: 'gemini-2.5-flash-image' },
]

const FALAI_IMAGE_MODELS = [
  { label: 'Nano Banana 2', id: 'nano-banana-2' },
  { label: 'Nano Banana Pro', id: 'nano-banana-pro' },
  { label: 'GPT Image 1.5', id: 'gpt-image-1.5' },
  { label: 'Seedream 4.5', id: 'seedream-v4.5' },
  { label: 'FLUX 2 Pro', id: 'flux-2-pro' },
  { label: 'Grok Imagine Image', id: 'grok-imagine-image' },
  { label: 'Nano Banana', id: 'nano-banana' },
]

const BASE_ASPECT_RATIO_OPTIONS = [
  { label: '1:1', id: '1:1' },
  { label: '16:9', id: '16:9' },
  { label: '9:16', id: '9:16' },
  { label: '3:2', id: '3:2' },
  { label: '2:3', id: '2:3' },
  { label: '4:3', id: '4:3' },
  { label: '3:4', id: '3:4' },
  { label: '5:4', id: '5:4' },
  { label: '4:5', id: '4:5' },
  { label: '21:9', id: '21:9' },
]

const EXTREME_ASPECT_RATIO_OPTIONS = [
  { label: '4:1', id: '4:1' },
  { label: '1:4', id: '1:4' },
  { label: '8:1', id: '8:1' },
  { label: '1:8', id: '1:8' },
]

const OUTPUT_FORMAT_OPTIONS = [
  { label: 'PNG', id: 'png' },
  { label: 'JPEG', id: 'jpeg' },
  { label: 'WebP', id: 'webp' },
]

export const ImageGeneratorBlock: BlockConfig<DalleResponse> = {
  type: 'image_generator',
  name: 'Image Generator',
  description: 'Generate images',
  hideFromToolbar: true,
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Image Generator into the workflow. Can generate images using DALL-E 3 and GPT Image models.',
  docsLink: 'https://docs.sim.ai/tools/image_generator',
  category: 'tools',
  integrationType: IntegrationType.AI,
  tags: ['image-generation', 'llm'],
  bgColor: '#4D5FFF',
  icon: ImageIcon,
  subBlocks: [
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      options: [
        { label: 'DALL-E 3', id: 'dall-e-3' },
        { label: 'GPT Image 1', id: 'gpt-image-1' },
        { label: 'GPT Image 2', id: 'gpt-image-2' },
      ],
      value: () => 'dall-e-3',
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
      condition: { field: 'model', value: 'dall-e-3' },
      dependsOn: ['model'],
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
      condition: { field: 'model', value: 'gpt-image-1' },
      dependsOn: ['model'],
    },
    {
      id: 'size',
      title: 'Size',
      type: 'dropdown',
      options: [
        { label: 'Auto', id: 'auto' },
        { label: 'Square (1024x1024)', id: '1024x1024' },
        { label: 'Portrait (1024x1536)', id: '1024x1536' },
        { label: 'Landscape (1536x1024)', id: '1536x1024' },
        { label: '2K (2560x1440)', id: '2560x1440' },
        { label: '4K (3840x2160)', id: '3840x2160' },
      ],
      value: () => 'auto',
      condition: { field: 'model', value: 'gpt-image-2' },
      dependsOn: ['model'],
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
      condition: { field: 'model', value: 'dall-e-3' },
      dependsOn: ['model'],
    },
    {
      id: 'quality',
      title: 'Quality',
      type: 'dropdown',
      options: [
        { label: 'Auto', id: 'auto' },
        { label: 'Low', id: 'low' },
        { label: 'Medium', id: 'medium' },
        { label: 'High', id: 'high' },
      ],
      value: () => 'auto',
      condition: { field: 'model', value: ['gpt-image-1', 'gpt-image-2'] },
      dependsOn: ['model'],
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
      condition: { field: 'model', value: 'dall-e-3' },
      dependsOn: ['model'],
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
      condition: { field: 'model', value: 'gpt-image-1' },
      dependsOn: ['model'],
    },
    {
      id: 'background',
      title: 'Background',
      type: 'dropdown',
      options: [
        { label: 'Auto', id: 'auto' },
        { label: 'Opaque', id: 'opaque' },
      ],
      value: () => 'auto',
      condition: { field: 'model', value: 'gpt-image-2' },
      dependsOn: ['model'],
    },
    {
      id: 'outputFormat',
      title: 'Output Format',
      type: 'dropdown',
      options: [
        { label: 'PNG', id: 'png' },
        { label: 'JPEG', id: 'jpeg' },
        { label: 'WebP', id: 'webp' },
      ],
      value: () => 'png',
      condition: { field: 'model', value: ['gpt-image-1', 'gpt-image-2'] },
      dependsOn: ['model'],
    },
    {
      id: 'moderation',
      title: 'Moderation',
      type: 'dropdown',
      options: [
        { label: 'Auto', id: 'auto' },
        { label: 'Low', id: 'low' },
      ],
      value: () => 'auto',
      condition: { field: 'model', value: ['gpt-image-1', 'gpt-image-2'] },
      dependsOn: ['model'],
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
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

        const model = params.model || 'dall-e-3'

        const ALLOWED_SIZES: Record<string, string[]> = {
          'dall-e-3': ['1024x1024', '1024x1792', '1792x1024'],
          'gpt-image-1': ['auto', '1024x1024', '1536x1024', '1024x1536'],
          'gpt-image-2': ['auto', '1024x1024', '1536x1024', '1024x1536', '2560x1440', '3840x2160'],
        }
        const ALLOWED_QUALITIES: Record<string, string[]> = {
          'dall-e-3': ['standard', 'hd'],
          'gpt-image-1': ['auto', 'low', 'medium', 'high'],
          'gpt-image-2': ['auto', 'low', 'medium', 'high'],
        }
        const ALLOWED_BACKGROUNDS: Record<string, string[]> = {
          'gpt-image-1': ['auto', 'transparent', 'opaque'],
          'gpt-image-2': ['auto', 'opaque'],
        }

        const defaultSize = model === 'dall-e-3' ? '1024x1024' : 'auto'
        const size = ALLOWED_SIZES[model]?.includes(params.size) ? params.size : defaultSize

        const baseParams = {
          prompt: params.prompt,
          model,
          size,
          apiKey: params.apiKey,
        }

        if (model === 'dall-e-3') {
          const quality = ALLOWED_QUALITIES['dall-e-3'].includes(params.quality)
            ? params.quality
            : 'standard'
          const style = ['vivid', 'natural'].includes(params.style) ? params.style : 'vivid'
          return { ...baseParams, quality, style }
        }
        if (model === 'gpt-image-1' || model === 'gpt-image-2') {
          const quality = ALLOWED_QUALITIES[model].includes(params.quality)
            ? params.quality
            : undefined
          const background = ALLOWED_BACKGROUNDS[model].includes(params.background)
            ? params.background
            : undefined
          return {
            ...baseParams,
            ...(quality && { quality }),
            ...(background && { background }),
            ...(params.outputFormat && { outputFormat: params.outputFormat }),
            ...(params.moderation && { moderation: params.moderation }),
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
    outputFormat: { type: 'string', description: 'Output image format (png, jpeg, webp)' },
    moderation: { type: 'string', description: 'Moderation level (auto or low)' },
    apiKey: { type: 'string', description: 'OpenAI API key' },
  },
  outputs: {
    content: { type: 'string', description: 'Generation response' },
    image: { type: 'file', description: 'Generated image file (UserFile)' },
    metadata: { type: 'json', description: 'Generation metadata' },
  },
}

export const ImageGeneratorV2Block: BlockConfig<ImageGenerationResponse> = {
  type: 'image_generator_v2',
  name: 'Image Generator',
  description: 'Generate images',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Generate images using OpenAI GPT Image, Google Nano Banana, or Fal.ai image models.',
  docsLink: 'https://docs.sim.ai/tools/image_generator',
  category: 'tools',
  integrationType: IntegrationType.AI,
  tags: ['image-generation', 'llm'],
  bgColor: '#4D5FFF',
  icon: ImageIcon,
  subBlocks: [
    {
      id: 'provider',
      title: 'Provider',
      type: 'dropdown',
      options: [
        { label: 'OpenAI', id: 'openai' },
        { label: 'Google Gemini', id: 'gemini' },
        { label: 'Fal.ai (Multi-Model)', id: 'falai' },
      ],
      commandSearchable: true,
      value: () => 'falai',
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      options: OPENAI_GPT_IMAGE_MODELS,
      value: () => 'gpt-image-1.5',
      condition: { field: 'provider', value: 'openai' },
      dependsOn: ['provider'],
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      options: GEMINI_IMAGE_MODELS,
      value: () => 'gemini-3.1-flash-image-preview',
      condition: { field: 'provider', value: 'gemini' },
      dependsOn: ['provider'],
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      options: FALAI_IMAGE_MODELS,
      value: () => 'nano-banana-2',
      condition: { field: 'provider', value: 'falai' },
      dependsOn: ['provider'],
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
        { label: 'Auto', id: 'auto' },
        { label: 'Square (1024x1024)', id: '1024x1024' },
        { label: 'Landscape (1536x1024)', id: '1536x1024' },
        { label: 'Portrait (1024x1536)', id: '1024x1536' },
      ],
      value: () => 'auto',
      condition: { field: 'provider', value: 'openai' },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'size',
      title: 'Size',
      type: 'dropdown',
      options: [
        { label: 'Square (1024x1024)', id: '1024x1024' },
        { label: 'Landscape (1536x1024)', id: '1536x1024' },
        { label: 'Portrait (1024x1536)', id: '1024x1536' },
      ],
      value: () => '1024x1024',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: 'gpt-image-1.5' },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'size',
      title: 'Size',
      type: 'dropdown',
      options: [
        { label: 'Auto 2K', id: 'auto_2K' },
        { label: 'Auto 4K', id: 'auto_4K' },
        { label: 'Square HD', id: 'square_hd' },
        { label: 'Square', id: 'square' },
        { label: 'Portrait 4:3', id: 'portrait_4_3' },
        { label: 'Portrait 16:9', id: 'portrait_16_9' },
        { label: 'Landscape 4:3', id: 'landscape_4_3' },
        { label: 'Landscape 16:9', id: 'landscape_16_9' },
      ],
      value: () => 'auto_2K',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: 'seedream-v4.5' },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'size',
      title: 'Size',
      type: 'dropdown',
      options: [
        { label: 'Landscape 4:3', id: 'landscape_4_3' },
        { label: 'Landscape 16:9', id: 'landscape_16_9' },
        { label: 'Square HD', id: 'square_hd' },
        { label: 'Square', id: 'square' },
        { label: 'Portrait 4:3', id: 'portrait_4_3' },
        { label: 'Portrait 16:9', id: 'portrait_16_9' },
      ],
      value: () => 'landscape_4_3',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: 'flux-2-pro' },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'aspectRatio',
      title: 'Aspect Ratio',
      type: 'dropdown',
      options: [...BASE_ASPECT_RATIO_OPTIONS, ...EXTREME_ASPECT_RATIO_OPTIONS],
      value: () => '1:1',
      condition: {
        field: 'provider',
        value: 'gemini',
        and: { field: 'model', value: 'gemini-3.1-flash-image-preview' },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'aspectRatio',
      title: 'Aspect Ratio',
      type: 'dropdown',
      options: BASE_ASPECT_RATIO_OPTIONS,
      value: () => '1:1',
      condition: {
        field: 'provider',
        value: 'gemini',
        and: {
          field: 'model',
          value: ['gemini-3-pro-image-preview', 'gemini-2.5-flash-image'],
        },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'aspectRatio',
      title: 'Aspect Ratio',
      type: 'dropdown',
      options: [
        { label: 'Auto', id: 'auto' },
        ...BASE_ASPECT_RATIO_OPTIONS,
        ...EXTREME_ASPECT_RATIO_OPTIONS,
      ],
      value: () => 'auto',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: 'nano-banana-2' },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'aspectRatio',
      title: 'Aspect Ratio',
      type: 'dropdown',
      options: [{ label: 'Auto', id: 'auto' }, ...BASE_ASPECT_RATIO_OPTIONS],
      value: () => '1:1',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: 'nano-banana-pro' },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'aspectRatio',
      title: 'Aspect Ratio',
      type: 'dropdown',
      options: BASE_ASPECT_RATIO_OPTIONS,
      value: () => '1:1',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: 'nano-banana' },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'aspectRatio',
      title: 'Aspect Ratio',
      type: 'dropdown',
      options: [
        { label: '1:1', id: '1:1' },
        { label: '16:9', id: '16:9' },
        { label: '9:16', id: '9:16' },
        { label: '4:3', id: '4:3' },
        { label: '3:2', id: '3:2' },
        { label: '2:3', id: '2:3' },
        { label: '3:4', id: '3:4' },
        { label: '2:1', id: '2:1' },
        { label: '1:2', id: '1:2' },
        { label: '20:9', id: '20:9' },
        { label: '9:20', id: '9:20' },
        { label: '19.5:9', id: '19.5:9' },
        { label: '9:19.5', id: '9:19.5' },
      ],
      value: () => '1:1',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: 'grok-imagine-image' },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      options: [
        { label: '512', id: '512' },
        { label: '1K', id: '1K' },
        { label: '2K', id: '2K' },
        { label: '4K', id: '4K' },
      ],
      value: () => '1K',
      condition: {
        field: 'provider',
        value: 'gemini',
        and: { field: 'model', value: 'gemini-3.1-flash-image-preview' },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      options: [
        { label: '1K', id: '1K' },
        { label: '2K', id: '2K' },
        { label: '4K', id: '4K' },
      ],
      value: () => '1K',
      condition: {
        field: 'provider',
        value: 'gemini',
        and: { field: 'model', value: 'gemini-3-pro-image-preview' },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      options: [
        { label: '0.5K', id: '0.5K' },
        { label: '1K', id: '1K' },
        { label: '2K', id: '2K' },
        { label: '4K', id: '4K' },
      ],
      value: () => '1K',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: 'nano-banana-2' },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      options: [
        { label: '1K', id: '1K' },
        { label: '2K', id: '2K' },
        { label: '4K', id: '4K' },
      ],
      value: () => '1K',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: 'nano-banana-pro' },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      options: [
        { label: '1k', id: '1k' },
        { label: '2k', id: '2k' },
      ],
      value: () => '1k',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: 'grok-imagine-image' },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'quality',
      title: 'Quality',
      type: 'dropdown',
      options: [
        { label: 'Auto', id: 'auto' },
        { label: 'Low', id: 'low' },
        { label: 'Medium', id: 'medium' },
        { label: 'High', id: 'high' },
      ],
      value: () => 'auto',
      condition: { field: 'provider', value: 'openai' },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'quality',
      title: 'Quality',
      type: 'dropdown',
      options: [
        { label: 'High', id: 'high' },
        { label: 'Medium', id: 'medium' },
        { label: 'Low', id: 'low' },
      ],
      value: () => 'high',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: 'gpt-image-1.5' },
      },
      dependsOn: ['provider', 'model'],
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
        value: ['openai', 'falai'],
        and: { field: 'model', value: ['gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'] },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'outputFormat',
      title: 'Output Format',
      type: 'dropdown',
      options: OUTPUT_FORMAT_OPTIONS,
      value: () => 'png',
      condition: {
        field: 'provider',
        value: ['openai', 'falai'],
        and: {
          field: 'model',
          value: [
            'gpt-image-1.5',
            'gpt-image-1',
            'gpt-image-1-mini',
            'nano-banana-2',
            'nano-banana-pro',
            'nano-banana',
            'grok-imagine-image',
          ],
        },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'outputFormat',
      title: 'Output Format',
      type: 'dropdown',
      options: [
        { label: 'JPEG', id: 'jpeg' },
        { label: 'PNG', id: 'png' },
      ],
      value: () => 'jpeg',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: 'flux-2-pro' },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'moderation',
      title: 'Moderation',
      type: 'dropdown',
      options: [
        { label: 'Auto', id: 'auto' },
        { label: 'Low', id: 'low' },
      ],
      value: () => 'auto',
      condition: { field: 'provider', value: 'openai' },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'safetyTolerance',
      title: 'Safety Tolerance',
      type: 'dropdown',
      options: [
        { label: '1', id: '1' },
        { label: '2', id: '2' },
        { label: '3', id: '3' },
        { label: '4', id: '4' },
        { label: '5', id: '5' },
        { label: '6', id: '6' },
      ],
      value: () => '4',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: ['nano-banana-2', 'nano-banana-pro', 'nano-banana'] },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'safetyTolerance',
      title: 'Safety Tolerance',
      type: 'dropdown',
      options: [
        { label: '1', id: '1' },
        { label: '2', id: '2' },
        { label: '3', id: '3' },
        { label: '4', id: '4' },
        { label: '5', id: '5' },
      ],
      value: () => '2',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: 'flux-2-pro' },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'thinkingLevel',
      title: 'Thinking Level',
      type: 'dropdown',
      options: [
        { label: 'Minimal', id: 'minimal' },
        { label: 'High', id: 'high' },
      ],
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: 'nano-banana-2' },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'enableWebSearch',
      title: 'Web Search',
      type: 'switch',
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: ['nano-banana-2', 'nano-banana-pro'] },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'enableSafetyChecker',
      title: 'Safety Checker',
      type: 'switch',
      defaultValue: true,
      condition: {
        field: 'provider',
        value: 'falai',
        and: { field: 'model', value: ['seedream-v4.5', 'flux-2-pro'] },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your provider API key',
      password: true,
      connectionDroppable: false,
      hideWhenHosted: true,
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
      condition: { field: 'provider', value: 'falai', not: true },
    },
  ],
  tools: {
    access: ['image_generate'],
    config: {
      tool: () => 'image_generate',
      params: (params) => {
        const provider = params.provider || 'openai'
        if (provider !== 'falai' && !params.apiKey) {
          throw new Error('API key is required')
        }
        if (!params.prompt) {
          throw new Error('Prompt is required')
        }
        const defaultModel =
          provider === 'gemini'
            ? 'gemini-3.1-flash-image-preview'
            : provider === 'falai'
              ? 'nano-banana-2'
              : 'gpt-image-1.5'

        return {
          provider,
          model: params.model || defaultModel,
          prompt: params.prompt,
          apiKey: params.apiKey,
          ...(params.size && { size: params.size }),
          ...(params.aspectRatio && { aspectRatio: params.aspectRatio }),
          ...(params.resolution && { resolution: params.resolution }),
          ...(params.quality && { quality: params.quality }),
          ...(params.background && { background: params.background }),
          ...(params.outputFormat && { outputFormat: params.outputFormat }),
          ...(params.moderation && { moderation: params.moderation }),
          ...(params.safetyTolerance && { safetyTolerance: params.safetyTolerance }),
          ...(params.thinkingLevel && { thinkingLevel: params.thinkingLevel }),
          ...(params.enableWebSearch !== undefined && {
            enableWebSearch: parseOptionalBooleanInput(params.enableWebSearch),
          }),
          ...(params.enableSafetyChecker !== undefined && {
            enableSafetyChecker: parseOptionalBooleanInput(params.enableSafetyChecker),
          }),
        }
      },
    },
  },
  inputs: {
    provider: { type: 'string', description: 'Image generation provider' },
    prompt: { type: 'string', description: 'Image description prompt' },
    model: { type: 'string', description: 'Image generation model' },
    size: { type: 'string', description: 'Image size' },
    aspectRatio: { type: 'string', description: 'Image aspect ratio' },
    resolution: { type: 'string', description: 'Image resolution' },
    quality: { type: 'string', description: 'Image quality level' },
    background: { type: 'string', description: 'Background type' },
    outputFormat: { type: 'string', description: 'Output image format' },
    moderation: { type: 'string', description: 'Moderation level' },
    safetyTolerance: { type: 'string', description: 'Fal.ai safety tolerance' },
    thinkingLevel: { type: 'string', description: 'Fal.ai thinking level' },
    enableWebSearch: { type: 'boolean', description: 'Enable Fal.ai web search grounding' },
    enableSafetyChecker: { type: 'boolean', description: 'Enable Fal.ai safety checker' },
    apiKey: { type: 'string', description: 'Provider API key' },
  },
  outputs: {
    content: { type: 'string', description: 'Generated image URL or identifier' },
    image: { type: 'file', description: 'Generated image file' },
    imageUrl: { type: 'string', description: 'Generated image URL' },
    provider: { type: 'string', description: 'Provider used' },
    model: { type: 'string', description: 'Model used' },
    metadata: { type: 'json', description: 'Generation metadata' },
  },
}
