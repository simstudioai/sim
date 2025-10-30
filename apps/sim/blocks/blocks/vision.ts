import { EyeIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { VisionResponse } from '@/tools/vision/types'

export const VisionBlock: BlockConfig<VisionResponse> = {
  type: 'vision',
  name: 'Vision',
  description: 'Analyze images with vision models',
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
    imageFileReference: { type: 'json', description: 'Image file reference' },
    model: { type: 'string', description: 'Vision model' },
    prompt: { type: 'string', description: 'Analysis prompt' },
  },
  outputs: {
    content: { type: 'string', description: 'Analysis result' },
    model: { type: 'string', description: 'Model used' },
    tokens: { type: 'number', description: 'Token usage' },
  },
}
