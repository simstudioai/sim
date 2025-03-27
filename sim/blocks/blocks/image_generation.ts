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
      options: ['DALL-E'],
      value: () => 'DALL-E',
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter a detailed description of the image you want to generate.\n\nDALL-E: Best for creative and artistic images, understands abstract concepts well.',
    },
    {
      id: 'promptTips',
      title: 'Prompt Engineering Tips',
      type: 'long-input',
      layout: 'full',
      value: () => 'Tips for DALL-E:\n- Be specific about art style, medium, and composition\n- Use descriptive adjectives\n- Mention lighting, perspective, and mood\n- Example: "A serene watercolor painting of a misty mountain lake at dawn, soft pastel colors, detailed reflections in the water"',
    },
    {
      id: 'resolution',
      title: 'Resolution',
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
      options: ['standard', 'hd'],
    },
    {
      id: 'style',
      title: 'Style',
      type: 'dropdown',
      layout: 'half',
      options: ['vivid', 'natural'],
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
      value: () => 'dall-e-2',
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
      placeholder: 'Enter your OpenAI API key',
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
    access: ['image_generation'],
    config: {
      tool: (params: Record<string, any>): string => {
        return 'image_generation'
      },
      params: (params: Record<string, any>) => {
        return {
          ...params,
          model: params.model || 'dall-e-2',
          resolution: params.resolution || '1024x1024',
          quality: params.quality || 'standard',
          style: params.style || 'vivid',
          outputFormat: params.outputFormat || 'url',
          ...(params.advancedParams ? JSON.parse(params.advancedParams) : {})
        }
      }
    }
  },
  inputs: {
    provider: { type: 'string', required: true },
    prompt: { type: 'string', required: true },
    resolution: { type: 'string', required: false },
    quality: { type: 'string', required: false },
    style: { type: 'string', required: false },
    model: { type: 'string', required: false },
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
      }
    }
  }
};