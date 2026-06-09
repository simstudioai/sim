import type { ToolResponse } from '@/tools/types'

export interface ResembleBaseParams {
  apiKey: string
  baseUrl?: string
  maxWaitSeconds?: number
}

export interface ResembleDetectParams extends ResembleBaseParams {
  url: string
  runIntelligence?: boolean
  audioSourceTracing?: boolean
  visualize?: boolean
  useReverseSearch?: boolean
  useOodDetector?: boolean
  zeroRetentionMode?: boolean
  modelTypes?: string
}

export interface ResembleIntelligenceParams extends ResembleBaseParams {
  url: string
  structuredJson?: boolean
  mediaType?: string
}

export interface ResembleWatermarkParams extends ResembleBaseParams {
  url: string
  strength?: number
  customMessage?: string
}

export interface ResembleResponse extends ToolResponse {
  output: {
    result: any
  }
}
