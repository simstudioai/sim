import type { ToolResponse } from '@/tools/types'

export type LangsmithRunType =
  | 'tool'
  | 'chain'
  | 'llm'
  | 'retriever'
  | 'embedding'
  | 'prompt'
  | 'parser'

export interface LangsmithRunPayload {
  id?: string
  name: string
  run_type: LangsmithRunType
  start_time?: string
  end_time?: string
  inputs?: Record<string, unknown>
  outputs?: Record<string, unknown>
  extra?: Record<string, unknown>
  tags?: string[]
  parent_run_id?: string
  trace_id?: string
  session_id?: string
  session_name?: string
  status?: string
  error?: string
  dotted_order?: string
  events?: Record<string, unknown>[]
}

export interface LangsmithCreateRunParams extends Omit<LangsmithRunPayload, 'outputs'> {
  apiKey: string
  run_outputs?: Record<string, unknown>
}

export interface LangsmithCreateRunsBatchParams {
  apiKey: string
  post?: LangsmithRunPayload[]
  patch?: LangsmithRunPayload[]
}

export interface LangsmithCreateRunResponse extends ToolResponse {
  output: {
    accepted: boolean
    runId: string | null
    message: string | null
  }
}

export interface LangsmithCreateRunsBatchResponse extends ToolResponse {
  output: {
    accepted: boolean
    runIds: string[]
    message: string | null
    messages?: string[]
  }
}

export interface LangsmithUpdateRunParams {
  apiKey: string
  runId: string
  name?: string
  end_time?: string
  outputs?: Record<string, unknown>
  extra?: Record<string, unknown>
  tags?: string[]
  status?: string
  error?: string
  events?: Record<string, unknown>[]
}

export interface LangsmithUpdateRunResponse extends ToolResponse {
  output: {
    accepted: boolean
    runId: string
    message: string | null
  }
}

export interface LangsmithGetRunParams {
  apiKey: string
  runId: string
}

export interface LangsmithGetRunResponse extends ToolResponse {
  output: {
    id: string
    runId: string
    name: string
    runType: string
    status: string | null
    startTime: string | null
    endTime: string | null
    inputs: Record<string, unknown> | null
    outputs: Record<string, unknown> | null
    error: string | null
    tags: string[]
    sessionId: string | null
    traceId: string | null
    parentRunId: string | null
    totalTokens: number | null
    totalCost: string | null
  }
}

export type LangsmithFeedbackSourceType = 'api' | 'app' | 'model'

export interface LangsmithCreateFeedbackParams {
  apiKey: string
  runId: string
  key: string
  score?: number
  value?: string
  comment?: string
  correction?: Record<string, unknown>
  feedbackSourceType?: LangsmithFeedbackSourceType
}

export interface LangsmithCreateFeedbackResponse extends ToolResponse {
  output: {
    id: string
    key: string
    runId: string | null
    score: number | null
    value: string | number | boolean | null
    comment: string | null
    createdAt: string | null
  }
}

export type LangsmithResponse =
  | LangsmithCreateRunResponse
  | LangsmithCreateRunsBatchResponse
  | LangsmithUpdateRunResponse
  | LangsmithGetRunResponse
  | LangsmithCreateFeedbackResponse
