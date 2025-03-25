import { ImageIcon } from '@/components/icons'
import { BlockConfig, SubBlockConfig } from '../types'
import { ToolResponse } from '@/tools/types'
import { processImageGenerationResponse, handleImageGenerationError } from '../utils'
import { ExecutionContext } from '@/executor/types'

interface ImageGenerationResponse extends ToolResponse {
  output: {
    imageUrl: string
    provider: string
    metadata: {
      prompt: string
      width: number
      height: number
      model: string
      style?: string
      quality?: string
      format: string
      seed?: number
      additionalParams?: Record<string, any>
    }
  }
}

export const ImageGenerationBlock: BlockConfig<ImageGenerationResponse> = {
  type: 'image_generation',
  name: 'Image Generation',
  description: 'Generate images with AI',
  longDescription: 
    'Create AI-generated images using multiple providers including DALL-E, Midjourney, and Stable Diffusion. Customize prompts, styles, and output formats.',
  category: 'blocks',
  bgColor: '#FF2F9A',
  icon: ImageIcon,
  subBlocks: [
    {
      id: 'provider',
      title: 'Provider',
      type: 'dropdown',
      layout: 'half',
      options: ['DALL-E', 'Midjourney', 'Stable Diffusion'],
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter a detailed description of the image you want to generate.\n\nProvider Strengths:\nDALL-E: Best for creative and artistic images, understands abstract concepts well.\nMidjourney: Excels at realistic and highly detailed images, great for architectural and product visualization.\nStable Diffusion: Strong at artistic styles, character design, and scene composition.',
    },
    {
      id: 'promptTips',
      title: 'Prompt Engineering Tips',
      type: 'long-input',
      layout: 'full',
      value: ({ provider }) => {
        switch (provider) {
          case 'DALL-E':
            return 'Tips for DALL-E:\n- Be specific about art style, medium, and composition\n- Use descriptive adjectives\n- Mention lighting, perspective, and mood\n- Example: "A serene watercolor painting of a misty mountain lake at dawn, soft pastel colors, detailed reflections in the water"'
          case 'Midjourney':
            return 'Tips for Midjourney:\n- Use --ar for aspect ratio\n- Add style modifiers like --s for stylization\n- Specify camera details (e.g., "shot on Leica")\n- Example: "hyperrealistic product photo of a modern minimalist chair, studio lighting, 8k, professional photography --ar 4:3"'
          case 'Stable Diffusion':
            return 'Tips for Stable Diffusion:\n- Use quality tags: "masterpiece, best quality, highly detailed"\n- Specify art style: "digital art", "oil painting", etc.\n- Use weights: "(keyword:1.2) for emphasis"\n- Example: "masterpiece, best quality, highly detailed, digital painting of a cyberpunk cityscape at night, neon lights, rain-slicked streets, (volumetric lighting:1.2)"'
          default:
            return 'Select a provider to see specific prompt engineering tips.'
        }
      },
      condition: { field: 'provider', value: ['DALL-E', 'Midjourney', 'Stable Diffusion'] },
    },
    {
      id: 'negativePrompt',
      title: 'Negative Prompt',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Elements to avoid in the generated image...',
      condition: {
        field: 'provider',
        value: ['Stable Diffusion', 'Midjourney'],
      },
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: '256x256', id: '256x256' },
        { label: '512x512', id: '512x512' },
        { label: '1024x1024', id: '1024x1024' },
        { label: '1024x1792', id: '1024x1792' },
        { label: '1792x1024', id: '1792x1024' },
      ],
    },
    {
      id: 'quality',
      title: 'Quality',
      type: 'dropdown',
      layout: 'half',
      options: ['standard', 'hd'],
      condition: {
        field: 'provider',
        value: 'DALL-E',
      },
    },
    {
      id: 'style',
      title: 'Style',
      type: 'dropdown',
      layout: 'half',
      options: ['vivid', 'natural'],
      condition: {
        field: 'provider',
        value: 'DALL-E',
      },
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'DALL-E 3', id: 'dall-e-3' },
        { label: 'DALL-E 2', id: 'dall-e-2' },
      ],
      condition: {
        field: 'provider',
        value: 'DALL-E',
      },
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'SD XL', id: 'sd-xl' },
        { label: 'SD 1.5', id: 'sd-1.5' },
        { label: 'Dreamshaper', id: 'dreamshaper' },
        { label: 'Realistic Vision', id: 'realistic-vision' },
      ],
      condition: {
        field: 'provider',
        value: 'Stable Diffusion',
      },
    },
    {
      id: 'model',
      title: 'Version',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'V6', id: 'v6' },
        { label: 'V5.2', id: 'v5.2' },
        { label: 'V5.1', id: 'v5.1' },
      ],
      condition: {
        field: 'provider',
        value: 'Midjourney',
      },
    },
    {
      id: 'seed',
      title: 'Seed (Optional)',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter a seed number',
      condition: {
        field: 'provider',
        value: ['Stable Diffusion', 'Midjourney'],
      },
    },
    {
      id: 'outputFormat',
      title: 'Output Format',
      type: 'dropdown',
      layout: 'half',
      options: ['png', 'jpg', 'webp'],
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your API key for the selected provider',
      password: true,
      connectionDroppable: false,
    },
    {
      id: 'advancedParams',
      title: 'Advanced Parameters',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter JSON for provider-specific parameters...',
    },
    {
      id: 'generationType',
      title: 'Generation Type',
      type: 'dropdown',
      layout: 'half',
      options: ['text-to-image', 'image-to-image', 'batch-generation'],
      value: () => 'text-to-image',
    },
    {
      id: 'sourceImage',
      title: 'Source Image URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter the URL of the source image to modify',
      condition: { field: 'generationType', value: 'image-to-image' },
    },
    {
      id: 'imageStrength',
      title: 'Image Strength',
      type: 'slider',
      layout: 'half',
      min: 0,
      max: 100,
      value: () => '75',
      condition: { field: 'generationType', value: 'image-to-image' },
    },
    {
      id: 'batchPrompts',
      title: 'Batch Prompts',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter one prompt per line for batch generation',
      condition: { field: 'generationType', value: 'batch-generation' },
    },
    {
      id: 'batchSize',
      title: 'Batch Size',
      type: 'dropdown',
      layout: 'half',
      options: ['1', '2', '3', '4', '5', '10'],
      value: () => '1',
      condition: { field: 'generationType', value: 'batch-generation' },
    },
  ],
  tools: {
    access: ['http_request'],
    config: {
      tool: (params: Record<string, any>) => {
        const { provider, prompt, apiKey } = params

        // Validate required fields
        if (!provider) {
          throw new Error('Provider is required')
        }
        if (!prompt) {
          throw new Error('Prompt is required')
        }
        if (!apiKey) {
          throw new Error('API key is required')
        }

        // Validate API key format based on provider
        switch (provider) {
          case 'DALL-E':
            if (!apiKey || typeof apiKey !== 'string' || !apiKey.startsWith('sk-')) {
              console.error('API key validation issue:', {
                keyExists: !!apiKey,
                keyType: typeof apiKey,
                keyStartsWithSk: apiKey && typeof apiKey === 'string' ? apiKey.startsWith('sk-') : false
              });
              throw new Error('Invalid DALL-E API key format. Key should start with "sk-"')
            }
            break
          case 'Stable Diffusion':
            if (!apiKey.match(/^[a-zA-Z0-9-_]+$/)) {
              throw new Error('Invalid Stable Diffusion API key format')
            }
            break
          case 'Midjourney':
            if (!apiKey.match(/^[a-zA-Z0-9-_]+$/)) {
              throw new Error('Invalid Midjourney API key format')
            }
            break
        }

        // Log request details for debugging
        console.log('Image Generation Request:', {
          provider,
          prompt,
          resolution: params.resolution,
          model: params.model,
          generationType: params.generationType,
          timestamp: new Date().toISOString()
        })

        return 'http_request'
      },
      params: async (params: Record<string, any>) => {
        const { provider, prompt, apiKey, resolution, model, generationType } = params
        
        console.log('Image Generation Request (DETAILED):', {
          provider,
          promptLength: prompt.length,
          promptStart: prompt.substring(0, 20) + '...',
          resolution: params.resolution,
          model: params.model,
          generationType: params.generationType,
          apiKeyValid: !!apiKey && typeof apiKey === 'string',
          apiKeyLength: apiKey ? apiKey.length : 0,
          apiKeyFormat: apiKey ? (apiKey.startsWith('sk-') ? 'Starts with sk-' : 'Invalid format') : 'Missing'
        })
        // Configure request based on provider
        let url, method, body
        switch (provider) {
          case 'DALL-E':
            url = 'https://api.openai.com/v1/images/generations'
            method = 'POST'
            try {
              const directResult = await fetch('https://api.openai.com/v1/images/generations', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                  model: 'dall-e-2',
                  prompt: "Debug test: blue square",
                  n: 1,
                  size: '256x256'
                })
              });
              
              console.log('Direct API call status:', directResult.status);
              console.log('Direct API response:', await directResult.json());
            } catch (directError) {
              console.error('Direct API call failed:', directError);
            }
            body = {
              model: model || 'dall-e-2',
              prompt: prompt,
              n: 1,
              size: resolution || '256x256',
              response_format: 'url',
              quality: params.quality,
              style: params.style
            } as {
              model: string;
              prompt: string;
              n: number;
              size: string;
              response_format: string;
              quality?: string;
              style?: string;
            }
            
            break
          case 'Stable Diffusion':
            url = 'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image'
            method = 'POST'
            body = {
              text_prompts: [
                { text: prompt },
                { text: params.negativePrompt || '', weight: -1 }
              ],
              cfg_scale: 7,
              height: parseInt(resolution?.split('x')[1] || '1024'),
              width: parseInt(resolution?.split('x')[0] || '1024'),
              samples: 1,
              steps: 30,
              style_preset: 'photographic'
            }
            break
          case 'Midjourney':
            url = 'https://api.midjourney.com/v1/imagine'
            method = 'POST'
            body = {
              prompt,
              version: model || 'v6',
              aspect_ratio: resolution || '1:1',
              seed: params.seed
            }
            break
          default:
            throw new Error(`Unsupported provider: ${provider}`)
        }

        return {
          url,
          method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(body)
        }
      }
    }
  },
  inputs: {
    provider: { type: 'string', required: true },
    prompt: { type: 'string', required: true },
    negativePrompt: { type: 'string', required: false },
    resolution: { type: 'string', required: false },
    quality: { type: 'string', required: false },
    style: { type: 'string', required: false },
    model: { type: 'string', required: false },
    seed: { type: 'string', required: false },
    outputFormat: { type: 'string', required: false },
    apiKey: { type: 'string', required: true },
    advancedParams: { type: 'json', required: false },
    generationType: { type: 'string', required: false },
    sourceImage: { type: 'string', required: false },
    imageStrength: { type: 'string', required: false },
    batchPrompts: { type: 'string', required: false },
    batchSize: { type: 'string', required: false },
  },
  outputs: {
    response: {
      type: {
        imageUrl: 'string',
        provider: 'string',
        metadata: 'json',
      },
    },
  }
};