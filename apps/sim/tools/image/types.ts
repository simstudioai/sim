export interface ImageGenerationParams {
  provider: string
  model: string
  prompt: string
  width?: number
  height?: number
  negativePrompt?: string
  apiKey: string
}

export interface ImageGenerationRequestBody extends ImageGenerationParams {
  workspaceId?: string
  workflowId?: string
  executionId?: string
}
