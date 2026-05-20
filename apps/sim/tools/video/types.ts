import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

export interface VideoParams {
  provider: 'runway' | 'veo' | 'luma' | 'minimax' | 'falai'
  apiKey: string
  model?: string
  prompt: string
  duration?: number
  aspectRatio?: string
  resolution?: string
  /** Runway only, required for Runway generation */
  visualReference?: UserFile
  cameraControl?: {
    pan?: number
    zoom?: number
    tilt?: number
    truck?: number
    tracking?: boolean
  }
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

export interface VideoBlockResponse extends ToolResponse {
  output: {
    videoUrl: string
    videoFile?: UserFile
    duration?: number
    width?: number
    height?: number
    provider?: string
    model?: string
  }
}

interface RunwayParams extends Omit<VideoParams, 'provider'> {
  /** Only gen4_turbo supports image-to-video */
  model?: 'gen-4-turbo'
  /** Required for Gen-4 */
  visualReference: UserFile
  /** Gen-4 Turbo outputs at 720p */
  resolution?: '720p'
  duration?: 5 | 10
}

interface VeoParams extends Omit<VideoParams, 'provider'> {
  model?: 'veo-3' | 'veo-3-fast' | 'veo-3.1'
  aspectRatio?: '16:9' | '9:16'
  resolution?: '720p' | '1080p'
  duration?: 4 | 6 | 8
}

interface LumaParams extends Omit<VideoParams, 'provider'> {
  model?: 'ray3'
  cameraControl?: {
    pan?: number
    zoom?: number
    tilt?: number
    truck?: number
    tracking?: boolean
  }
  aspectRatio?: '16:9' | '9:16' | '1:1'
  resolution?: '540p' | '720p' | '1080p'
  duration?: 5 | 10
}

interface MinimaxParams extends Omit<VideoParams, 'provider'> {
  model?: 'hailuo-2.3' | 'hailuo-02'
  endpoint?: 'pro' | 'standard'
  promptOptimizer?: boolean
  duration?: 6 | 10
}

interface VideoRequestBody extends VideoParams {
  workspaceId?: string
  workflowId?: string
  executionId?: string
  userId?: string
}

interface RunwayJobResponse {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  videoUrl?: string
  progress?: number
  error?: string
}

interface VeoJobResponse {
  name: string
  done: boolean
  response?: {
    generatedVideo: {
      uri: string
      mimeType: string
    }
  }
  error?: {
    message: string
  }
}

interface LumaJobResponse {
  id: string
  state: 'queued' | 'processing' | 'completed' | 'failed'
  video?: {
    url: string
    width: number
    height: number
    duration: number
  }
  failure_reason?: string
}

interface MinimaxJobResponse {
  request_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  video_url?: string
  error?: string
}
