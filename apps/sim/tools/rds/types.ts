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

export interface RdsIntrospectParams extends RdsConnectionConfig {
  schema?: string
  engine?: 'aurora-postgresql' | 'aurora-mysql'
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

export interface RdsTableColumn {
  name: string
  type: string
  nullable: boolean
  default: string | null
  isPrimaryKey: boolean
  isForeignKey: boolean
  references?: {
    table: string
    column: string
  }
}

export interface RdsTableSchema {
  name: string
  schema: string
  columns: RdsTableColumn[]
  primaryKey: string[]
  foreignKeys: Array<{
    column: string
    referencesTable: string
    referencesColumn: string
  }>
  indexes: Array<{
    name: string
    columns: string[]
    unique: boolean
  }>
}

export interface RdsIntrospectResponse extends ToolResponse {
  output: {
    message: string
    engine: string
    tables: RdsTableSchema[]
    schemas: string[]
  }
  error?: string
}
