import type { ToolResponse } from '@/tools/types'

export interface SupabaseQueryParams {
  apiKey: string
  projectId: string
  table: string
  filter?: string
  orderBy?: string
  limit?: number
}

export interface SupabaseInsertParams {
  apiKey: string
  projectId: string
  table: string
  data: any
}

export interface SupabaseGetRowParams {
  apiKey: string
  projectId: string
  table: string
  filter: string
}

export interface SupabaseUpdateParams {
  apiKey: string
  projectId: string
  table: string
  filter: string
  data: any
}

export interface SupabaseDeleteParams {
  apiKey: string
  projectId: string
  table: string
  filter: string
}

export interface SupabaseUpsertParams {
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

export interface SupabaseGetRowResponse extends SupabaseBaseResponse {}

export interface SupabaseUpdateResponse extends SupabaseBaseResponse {}

export interface SupabaseDeleteResponse extends SupabaseBaseResponse {}

export interface SupabaseUpsertResponse extends SupabaseBaseResponse {}

export interface SupabaseResponse extends SupabaseBaseResponse {}
