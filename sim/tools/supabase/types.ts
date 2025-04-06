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
  data: any[]
  error: any
}

export interface SupabaseInsertResponse extends ToolResponse {
  data: any[]
  error: any
}