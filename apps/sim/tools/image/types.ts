import type { ToolResponse } from '@/tools/types'

export interface ImageParams {
  provider: 'openai' | 'falai'
  apiKey: string
  model?: string
  prompt: string
  size?: string
  aspectRatio?: string
  quality?: string
  style?: string
  background?: string
  numInferenceSteps?: number
  enableSafetyChecker?: boolean
  outputFormat?: string
}

export interface ImageResponse extends ToolResponse {
  output: {
    content: string // Image URL or identifier
    image: string // Base64 encoded image data
    metadata: {
      model: string
      provider?: string
      width?: number
      height?: number
      contentType?: string
    }
  }
}

export interface FalAIImageRequestBody {
  prompt: string
  image_size?: string | { width: number; height: number }
  num_inference_steps?: number
  num_images?: number
  seed?: number
  enable_safety_checker?: boolean
  output_format?: string
}

export interface FalAIImageResponse {
  images: Array<{
    url: string
    width: number
    height: number
    content_type: string
  }>
  timings?: {
    inference: number
  }
  seed?: number
  has_nsfw_concepts?: boolean[]
  prompt?: string
}
