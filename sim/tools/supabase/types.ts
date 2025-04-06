import { ToolResponse } from '../types'

export interface SupabaseQueryParams {
  apiKey: string
  projectId: string
  table: string
}

export interface SupabaseInsertParams {
  apiKey: string
  projectId: string
  table: string
  data: any
}

export interface SupabaseQueryResponse extends ToolResponse {
  error?: string
  output: {
    message: string
    results: any
  }
}

export interface SupabaseInsertResponse extends ToolResponse {
  error?: string
  output: {
    message: string
    results: any
  }
}