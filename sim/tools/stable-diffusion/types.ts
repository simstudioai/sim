import { ToolResponse } from '../types'

export interface StableDiffusionParams {
  prompt: string
  negative_prompt?: string
  model_id?: string
  width: number
  height: number
  samples?: number
  num_inference_steps?: number
  safety_checker?: string
  enhance_prompt?: string
  seed?: number
  guidance_scale?: number
  multi_lingual?: string
  panorama?: string
  self_attention?: string
  upscale?: string
  key: string
  outputFormat?: string
}

export interface StableDiffusionMetadata {
  generationTime?: number
  prompt?: string
  seed?: number
  width?: number
  height?: number
  negative_prompt?: string
  enhance_style?: string
}

export interface StableDiffusionOutput {
  content: string
  model: string
  provider: string
  metadata: StableDiffusionMetadata
}

export interface StableDiffusionResponse extends ToolResponse {
  output: {
    imageUrl: string
    provider: string
    metadata: {
      prompt: string
      width: number
      height: number
      model: string
      format: string
      seed?: number
      additionalParams?: Record<string, any>
    }
  }
} 