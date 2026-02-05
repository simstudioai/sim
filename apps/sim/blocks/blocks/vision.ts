import { EyeIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { createVersionedToolSelector, normalizeFileInput } from '@/blocks/utils'
import type { VisionResponse } from '@/tools/vision/types'

const VISION_MODEL_OPTIONS = [
  { label: 'GPT 5.2', id: 'gpt-5.2' },
  { label: 'GPT 5.1', id: 'gpt-5.1' },
  { label: 'GPT 5', id: 'gpt-5' },
  { label: 'GPT 5 Mini', id: 'gpt-5-mini' },
  { label: 'GPT 5 Nano', id: 'gpt-5-nano' },
  { label: 'Claude Opus 4.5', id: 'claude-opus-4-5' },
  { label: 'Claude Sonnet 4.5', id: 'claude-sonnet-4-5' },
  { label: 'Claude Haiku 4.5', id: 'claude-haiku-4-5' },
  { label: 'Gemini 3 Pro Preview', id: 'gemini-3-pro-preview' },
  { label: 'Gemini 3 Flash Preview', id: 'gemini-3-flash-preview' },
  { label: 'Gemini 2.5 Pro', id: 'gemini-2.5-pro' },
  { label: 'Gemini 2.5 Flash', id: 'gemini-2.5-flash' },
  { label: 'Gemini 2.5 Flash Lite', id: 'gemini-2.5-flash-lite' },
]

export const VisionBlock: BlockConfig<VisionResponse> = {
  type: 'vision',
  name: 'Vision (Legacy)',
  description: 'Analyze images with vision models',
  hideFromToolbar: true,
  authMode: AuthMode.ApiKey,
  longDescription: 'Integrate Vision into the workflow. Can analyze images with vision models.',
  docsLink: 'https://docs.sim.ai/tools/vision',
  category: 'tools',
  bgColor: '#4D5FFF',
  icon: EyeIcon,
  subBlocks: [
    // Image file upload (basic mode)
    {
      id: 'imageFile',
      title: 'Image File',
      type: 'file-upload',
      canonicalParamId: 'imageFile',
      placeholder: 'Upload an image file',
      mode: 'basic',
      multiple: false,
      required: false,
      acceptedTypes: '.jpg,.jpeg,.png,.gif,.webp',
    },
    // Image file reference (advanced mode)
    {
      id: 'imageFileReference',
      title: 'Image File Reference',
      type: 'short-input',
      canonicalParamId: 'imageFile',
      placeholder: 'Reference an image from previous blocks',
      mode: 'advanced',
      required: false,
    },
    {
      id: 'imageUrl',
      title: 'Image URL (alternative)',
      type: 'short-input',
      placeholder: 'Or enter publicly accessible image URL',
      required: false,
    },
    {
      id: 'model',
      title: 'Vision Model',
      type: 'dropdown',
      options: VISION_MODEL_OPTIONS,
      value: () => 'gpt-5.2',
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      placeholder: 'Enter prompt for image analysis',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
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
    imageFile: { type: 'json', description: 'Image file (UserFile)' },
    model: { type: 'string', description: 'Vision model' },
    prompt: { type: 'string', description: 'Analysis prompt' },
  },
  outputs: {
    content: { type: 'string', description: 'Analysis result' },
    model: { type: 'string', description: 'Model used' },
    tokens: { type: 'number', description: 'Token usage' },
  },
}

export const VisionV2Block: BlockConfig<VisionResponse> = {
  ...VisionBlock,
  type: 'vision_v2',
  name: 'Vision',
  description: 'Analyze images with vision models',
  hideFromToolbar: false,
  tools: {
    access: ['vision_tool_v2'],
    config: {
      tool: createVersionedToolSelector({
        baseToolSelector: () => 'vision_tool',
        suffix: '_v2',
        fallbackToolId: 'vision_tool_v2',
      }),
      params: (params) => {
        // imageFile is the canonical param for both basic and advanced modes
        const imageFile = normalizeFileInput(params.imageFile, {
          single: true,
        })
        return {
          ...params,
          imageFile,
        }
      },
    },
  },
  subBlocks: [
    {
      id: 'imageFile',
      title: 'Image File',
      type: 'file-upload',
      canonicalParamId: 'imageFile',
      placeholder: 'Upload an image file',
      mode: 'basic',
      multiple: false,
      required: true,
      acceptedTypes: '.jpg,.jpeg,.png,.gif,.webp',
    },
    {
      id: 'imageFileReference',
      title: 'Image File Reference',
      type: 'short-input',
      canonicalParamId: 'imageFile',
      placeholder: 'Reference an image from previous blocks',
      mode: 'advanced',
      required: true,
    },
    {
      id: 'model',
      title: 'Vision Model',
      type: 'dropdown',
      options: VISION_MODEL_OPTIONS,
      value: () => 'gpt-5.2',
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      placeholder: 'Enter prompt for image analysis',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your API key',
      password: true,
      required: true,
    },
  ],
  inputs: {
    apiKey: { type: 'string', description: 'Provider API key' },
    imageFile: { type: 'json', description: 'Image file (UserFile)' },
    model: { type: 'string', description: 'Vision model' },
    prompt: { type: 'string', description: 'Analysis prompt' },
  },
}
