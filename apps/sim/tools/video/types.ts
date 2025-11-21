import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

export interface VideoParams {
  provider: 'runway' | 'veo' | 'luma' | 'minimax'
  apiKey: string
  model?: string
  prompt: string
  duration?: number
  aspectRatio?: string
  resolution?: string
  // Provider-specific features
  visualReference?: UserFile // Runway only
  consistencyMode?: string // Runway only
  stylePreset?: string // Runway only
  cameraControl?: {
    // Luma only
    pan?: number
    zoom?: number
    tilt?: number
    truck?: number
    tracking?: boolean
  }
  endpoint?: string // MiniMax: 'pro' | 'standard'
  promptOptimizer?: boolean // MiniMax only
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

export interface RunwayParams extends Omit<VideoParams, 'provider'> {
  model?: 'gen-4' | 'gen-4-turbo'
  visualReference?: UserFile
  consistencyMode?: 'character' | 'object' | 'style' | 'location'
  stylePreset?: string
  resolution?: '720p' | '1080p' | '4k'
  duration?: 5 | 10
}

export interface VeoParams extends Omit<VideoParams, 'provider'> {
  model?: 'veo-3' | 'veo-3-fast' | 'veo-3.1'
  aspectRatio?: '16:9' | '9:16'
  resolution?: '720p' | '1080p'
  duration?: 4 | 6 | 8
}

export interface LumaParams extends Omit<VideoParams, 'provider'> {
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

export interface MinimaxParams extends Omit<VideoParams, 'provider'> {
  model?: 'hailuo-02'
  endpoint?: 'pro' | 'standard'
  promptOptimizer?: boolean
  duration?: 6 | 10
}

export interface VideoRequestBody extends VideoParams {
  workspaceId?: string
  workflowId?: string
  executionId?: string
  userId?: string
}

export interface RunwayJobResponse {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  videoUrl?: string
  progress?: number
  error?: string
}

export interface VeoJobResponse {
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

export interface LumaJobResponse {
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

export interface MinimaxJobResponse {
  request_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  video_url?: string
  error?: string
}
