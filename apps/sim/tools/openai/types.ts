import type { ToolResponse } from '../types'

export interface BaseImageRequestBody {
  model: string
  prompt: string
  size: string
  n: number
  [key: string]: any // Allow for additional properties
}

export interface DalleResponse extends ToolResponse {
  output: {
    content: string // This will now be the image URL
    image: string // This will be the base64 image data
    metadata: {
      model: string // Only contains model name now
    }
  }
}

export interface OpenAIEmbeddingsParams {
  apiKey: string
  input: string | string[]
  model?: string
  encodingFormat?: 'float' | 'base64'
  user?: string
}
