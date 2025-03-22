import { ToolResponse } from '../types'

export interface SupabaseQueryParams {
  credential: string
  projectId: string
  table: string
  select?: string
  filter?: {
    column: string
    operator: string
    value: any
  }
}

export interface SupabaseInsertParams {
  credential: string
  projectId: string
  table: string
  data: Record<string, any>
}

export interface SupabaseUpdateParams {
  credential: string
  projectId: string
  table: string
  data: Record<string, any>
  filter: {
    column: string
    operator: string
    value: any
  }
}

export interface SupabaseDeleteParams {
  credential: string
  projectId: string
  table: string
  filter: {
    column: string
    operator: string
    value: any
  }
}

export interface SupabaseQueryResponse extends ToolResponse {
  data: any[]
  error: any
}

export interface SupabaseInsertResponse extends ToolResponse {
  data: any[]
  error: any
}

export interface SupabaseUpdateResponse extends ToolResponse {
  data: any[]
  error: any
}

export interface SupabaseDeleteResponse extends ToolResponse {
  data: any[]
  error: any
}
