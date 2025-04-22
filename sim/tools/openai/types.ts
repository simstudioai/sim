import { ToolResponse } from "../types"

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
    encoding_format?: 'float' | 'base64'
    user?: string
  }