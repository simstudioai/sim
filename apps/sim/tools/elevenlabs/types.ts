import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

export interface ElevenLabsTtsParams {
  apiKey: string
  text: string
  voiceId: string
  modelId?: string
  stability?: number
  similarity?: number
}

export interface ElevenLabsTtsResponse extends ToolResponse {
  output: {
    audioUrl: string
    audioFile?: UserFile
  }
}

export interface ElevenLabsBlockResponse extends ToolResponse {
  output: {
    audioUrl: string
    audioFile?: UserFile
  }
}
