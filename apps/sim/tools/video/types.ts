import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

export interface VideoParams {
  provider: 'runway' | 'veo' | 'luma' | 'minimax' | 'falai' | 'higgsfield'
  apiKey: string
  model?: string
  prompt: string
  duration?: number
  aspectRatio?: string
  resolution?: string
  /** Runway reference image; required for image-only models */
  visualReference?: UserFile
  cameraControl?: { key: string }[]
  endpoint?: string
  promptOptimizer?: boolean
  generateAudio?: boolean
}

export interface VideoResponse extends ToolResponse {
  output: {
    videoUrl: string
    videoFile?: UserFile
    duration?: number
    width?: number
    height?: number
    provider?: string
    model?: string
    jobId?: string
    __falaiCostDollars?: number
    __falaiBilling?: {
      endpointId: string
      requestId: string
      source: 'billing_events' | 'historical_estimate' | 'fallback_floor'
      outputUnits?: number | null
      unitPrice?: number | null
      percentDiscount?: number | null
      currency?: string
      error?: string
    }
  }
}
