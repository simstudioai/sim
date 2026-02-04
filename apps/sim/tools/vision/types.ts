import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

export interface VisionParams {
  apiKey: string
  imageUrl?: string
  imageFile?: UserFile
  model?: string
  prompt?: string
}

export interface VisionV2Params {
  apiKey: string
  imageFile: UserFile
  model?: string
  prompt?: string
}

export interface VisionResponse extends ToolResponse {
  output: {
    content: string
    model?: string
    tokens?: number
  }
}
