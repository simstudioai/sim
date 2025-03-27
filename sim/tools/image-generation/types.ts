export interface ImageGenerationParams {
  prompt: string
  model?: 'dall-e-2' | 'dall-e-3'
  resolution?: string
  quality?: 'standard' | 'hd'
  style?: 'vivid' | 'natural'
  n?: number
  apiKey: string
}

export interface ImageGenerationMetadata {
  created?: number
  revisedPrompt?: string
  prompt?: string
}

export interface ImageGenerationOutput {
  content: string
  model: string
  provider: string
  metadata: ImageGenerationMetadata
}

export interface ImageGenerationResponse {
  success: boolean
  output: ImageGenerationOutput
}

export interface StableDiffusionResponse {
  status: string
  generationTime: number
  id: number
  output: string[]
  proxy_links?: string[]
  meta: {
    base64: string
    enhance_prompt: string
    enhance_style: string | null
    file_prefix: string
    width: number
    height: number
    instant_response: string
    n_samples: number
    negative_prompt: string
    prompt: string
    safety_checker: string
    seed: number
  }
}

export interface ImageGenerationError {
  success: false
  error: string
  output: {
    content: string
    model: string
    provider: string
    metadata: {
      created?: number
      revisedPrompt?: string
      prompt?: string
    }
  }
} 