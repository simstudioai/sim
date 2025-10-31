import type { ToolResponse } from '@/tools/types'

/**
 * Parameters for creating a Replicate prediction
 */
export interface ReplicatePredictionParams {
  apiKey: string
  model: string
  version?: string
  input: Record<string, any>
  webhook?: string
  mode?: 'async' | 'sync'
  timeout?: number
}

/**
 * Parameters for getting a prediction status
 */
export interface ReplicateGetPredictionParams {
  predictionId: string
  apiKey: string
}

/**
 * Replicate prediction status types
 */
export type ReplicatePredictionStatus =
  | 'starting'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'canceled'

/**
 * Replicate prediction object structure
 */
export interface ReplicatePrediction {
  id: string
  status: ReplicatePredictionStatus
  input: Record<string, any>
  output: any
  error: string | null
  logs: string | null
  urls: {
    get: string
    cancel: string
  }
  metrics?: {
    predict_time?: number
  }
  created_at: string
  started_at?: string
  completed_at?: string
}

/**
 * Response from Replicate create prediction tool
 */
export interface ReplicateResponse extends ToolResponse {
  output: {
    id: string
    status: ReplicatePredictionStatus
    output: any
    error: string | null
    urls: {
      get: string
      cancel: string
    }
    metrics?: {
      predict_time?: number
    }
  }
}
