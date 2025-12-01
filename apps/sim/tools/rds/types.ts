import type { ToolResponse } from '@/tools/types'

export interface RdsConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
  resourceArn: string
  secretArn: string
  database?: string
}

export interface RdsQueryParams extends RdsConnectionConfig {
  query: string
}

export interface RdsInsertParams extends RdsConnectionConfig {
  table: string
  data: Record<string, unknown>
}

export interface RdsUpdateParams extends RdsConnectionConfig {
  table: string
  data: Record<string, unknown>
  conditions: Record<string, unknown>
}

export interface RdsDeleteParams extends RdsConnectionConfig {
  table: string
  conditions: Record<string, unknown>
}

export interface RdsExecuteParams extends RdsConnectionConfig {
  query: string
}

export interface RdsBaseResponse extends ToolResponse {
  output: {
    message: string
    rows: unknown[]
    rowCount: number
  }
  error?: string
}

export interface RdsQueryResponse extends RdsBaseResponse {}
export interface RdsInsertResponse extends RdsBaseResponse {}
export interface RdsUpdateResponse extends RdsBaseResponse {}
export interface RdsDeleteResponse extends RdsBaseResponse {}
export interface RdsExecuteResponse extends RdsBaseResponse {}
export interface RdsResponse extends RdsBaseResponse {}
