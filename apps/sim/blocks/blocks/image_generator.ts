import { ImageIcon } from '@/components/icons'
import {
  getImageModel,
  imageModelDefaults,
  imageModels,
  imageOptionFields,
} from '@/lib/media/image-catalog'
import { AuthMode, type BlockConfig, IntegrationType, type SubBlockConfig } from '@/blocks/types'
import { parseOptionalBooleanInput } from '@/blocks/utils'

export const ImageGeneratorBlock: BlockConfig = {
  type: 'image_generator',
  name: 'Image Generator',
  description: 'Generate images',
  hideFromToolbar: true,
  sunset: { status: 'legacy', replacedBy: 'image_generator_v2' },
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Image Generator into the workflow. Can generate images using DALL-E 3 and GPT Image models.',
  docsLink: 'https://docs.sim.ai/integrations/image_generator',
  category: 'blocks',
  integrationType: IntegrationType.AI,
  bgColor: '#4D5FFF',
  icon: ImageIcon,
  canvasPresentation: {
    defaultTitle: 'Image Generator',
    sentences: {
      default: [
        { text: 'Generate an image from', field: 'prompt', core: true },
        { text: 'with', field: 'model' },
      ],
    },
  },
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

export const ImageGeneratorV2Block: BlockConfig = {
  type: 'image_generator_v2',
  name: 'Image Generator',
  description: 'Generate images',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Generate images using OpenAI GPT Image, Google Nano Banana, Higgsfield SOUL and Z-Image, or Fal.ai image models.',
  docsLink: 'https://docs.sim.ai/integrations/image_generator',
  category: 'blocks',
  integrationType: IntegrationType.AI,
  bgColor: '#4D5FFF',
  icon: ImageIcon,
  canvasPresentation: {
    defaultTitle: 'Image Generator',
    sentences: {
      default: [
        { text: 'Generate an image from', field: 'prompt', core: true },
        { text: 'with', field: 'model' },
      ],
    },
  },
  subBlocks: [
    {
      id: 'provider',
      title: 'Provider',
      type: 'dropdown',
      options: [
        { label: 'OpenAI', id: 'openai' },
        { label: 'Google Gemini', id: 'gemini' },
        { label: 'Higgsfield', id: 'higgsfield' },
        { label: 'Fal.ai (Multi-Model)', id: 'falai' },
      ],
      commandSearchable: true,
      value: () => 'falai',
    },
    ...(['openai', 'gemini', 'higgsfield', 'falai'] as const).map(
      (provider): SubBlockConfig => ({
        id: 'model',
        title: 'Model',
        type: 'combobox',
        placeholder: 'Type or select a model...',
        mediaModelOptions: true,
        restoreDefaultWhenCleared: true,
        options: (params) =>
          imageModels
            .filter((model) => !params || model.provider === provider)
            .flatMap((model) => [
              { label: model.label, id: model.id },
              ...(model.aliases ?? []).map((id) => ({ id, label: model.label, hidden: true })),
            ]),
        value: () => imageModelDefaults[provider],
        condition: { field: 'provider', value: provider },
        dependsOn: ['provider'],
        required: true,
      })
    ),
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      required: true,
      placeholder: 'Describe the image you want to generate...',
    },
    ...imageOptionFields.map(
      (key): SubBlockConfig => ({
        id: key,
        title: {
          size: 'Size',
          aspectRatio: 'Aspect Ratio',
          resolution: 'Resolution',
          quality: 'Quality',
          background: 'Background',
          outputFormat: 'Output Format',
          moderation: 'Moderation',
          safetyTolerance: 'Safety Tolerance',
          thinkingLevel: 'Thinking Level',
        }[key],
        type: 'dropdown',
        value: () => 'default',
        dependsOn: ['provider', 'model'],
        condition: (values) => ({
          field: 'model',
          value: getImageModel(values?.provider, values?.model)?.options?.[key]
            ? [String(values?.model)]
            : [],
        }),
        options: (params) => [
          { id: 'default', label: 'Model default' },
          ...(params
            ? (getImageModel(params.values.provider, params.values.model)?.options?.[key]?.values ??
              [])
            : [...new Set(imageModels.flatMap((model) => model.options?.[key]?.values ?? []))]
          ).map((value) => ({
            id: String(value),
            label: String(value),
          })),
        ],
      })
    ),
    ...(['enableSafetyChecker', 'enableWebSearch'] as const).map(
      (key): SubBlockConfig => ({
        id: key,
        title: key === 'enableSafetyChecker' ? 'Safety Checker' : 'Web Search',
        type: 'switch',
        defaultValue: key === 'enableSafetyChecker',
        mode: 'advanced',
        dependsOn: ['provider', 'model'],
        condition: (values) => ({
          field: 'model',
          value: getImageModel(values?.provider, values?.model)?.booleans?.[key]
            ? [String(values?.model)]
            : [],
        }),
      })
    ),
    {
      id: 'seed',
      title: 'Seed',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Random by default',
      dependsOn: ['provider', 'model'],
      condition: (values) => ({
        field: 'model',
        value: getImageModel(values?.provider, values?.model)?.seed ? [String(values?.model)] : [],
      }),
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
        const modelId =
          params.model || imageModelDefaults[provider as keyof typeof imageModelDefaults]
        const model = getImageModel(provider, modelId)
        const settings: Record<string, unknown> = {}
        for (const key of imageOptionFields) {
          if (model?.options?.[key] && params[key] && params[key] !== 'default')
            settings[key] = params[key]
        }
        for (const key of ['enableSafetyChecker', 'enableWebSearch'] as const) {
          if (model?.booleans?.[key] && params[key] !== undefined && params[key] !== 'default') {
            settings[key] = parseOptionalBooleanInput(params[key])
          }
        }
        if (model?.seed && params.seed !== undefined && params.seed !== '')
          settings.seed = params.seed
        return {
          provider,
          model: modelId,
          prompt: params.prompt,
          apiKey: params.apiKey,
          ...settings,
        }
      },
    },
  },
  inputs: {
    provider: { type: 'string', description: 'Image generation provider' },
    prompt: {
      type: 'string',
      description: 'Image description, up to 4,000 characters. Some models have a lower limit.',
    },
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
    seed: { type: 'number', description: 'Random seed when supported' },
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
