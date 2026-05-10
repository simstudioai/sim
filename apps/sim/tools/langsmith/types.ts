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

export type LangsmithResponse = LangsmithCreateRunResponse | LangsmithCreateRunsBatchResponse
