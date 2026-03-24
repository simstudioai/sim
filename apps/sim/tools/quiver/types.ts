import type { ToolResponse } from '@/tools/types'

export interface QuiverTextToSvgParams {
  apiKey: string
  prompt: string
  model: string
  instructions?: string
  references?: unknown
  n?: number
  temperature?: number
  top_p?: number
  max_output_tokens?: number
  presence_penalty?: number
}

export interface QuiverImageToSvgParams {
  apiKey: string
  model: string
  image: unknown
  temperature?: number
  top_p?: number
  max_output_tokens?: number
  presence_penalty?: number
  auto_crop?: boolean
  target_size?: number
}

export interface QuiverListModelsParams {
  apiKey: string
}

export interface QuiverSvgResponse extends ToolResponse {
  output: {
    file: {
      name: string
      mimeType: string
      data: string
      size: number
    }
    files: Array<{
      name: string
      mimeType: string
      data: string
      size: number
    }>
    svgContent: string
    id: string
    usage: {
      totalTokens: number
      inputTokens: number
      outputTokens: number
    } | null
  }
}

export interface QuiverListModelsResponse extends ToolResponse {
  output: {
    models: Array<{
      id: string
      name: string
      description: string
      created: number | null
      ownedBy: string | null
      inputModalities: string[]
      outputModalities: string[]
      contextLength: number | null
      maxOutputLength: number | null
      supportedOperations: string[]
      supportedSamplingParameters: string[]
    }>
  }
}
