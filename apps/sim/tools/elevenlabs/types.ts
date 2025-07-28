import type { ToolResponse } from '@/tools/types'

export interface ElevenLabsTtsParams {
  apiKey: string
  text: string
  voiceId: string
  modelId?: string
}

export interface ElevenLabsTtsResponse extends ToolResponse {
  output: {
    audioUrl: string
  }
}

export interface ElevenLabsBlockResponse extends ToolResponse {
  output: {
    audioUrl: string
  }
}
