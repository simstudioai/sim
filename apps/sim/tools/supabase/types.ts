import type { ToolResponse } from '../types'

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

export interface SupabaseBaseResponse extends ToolResponse {
  output: {
    message: string
    results: any
  }
  error?: string
}

export interface SupabaseQueryResponse extends SupabaseBaseResponse {}

export interface SupabaseInsertResponse extends SupabaseBaseResponse {}

export interface SupabaseResponse extends SupabaseBaseResponse {}
