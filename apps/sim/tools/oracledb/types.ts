import type { OutputProperty, ToolResponse } from '@/tools/types'

export type OracleProtocol = 'tcp' | 'tcps'
export type OracleConnectionType = 'serviceName' | 'sid'
export type OracleBindScalar = string | number | null
export type OracleBinds = Record<string, OracleBindScalar>

/** Connection fields accepted by every Oracle Database tool. */
export interface OracleConnectionConfig {
  host: string
  port: number
  protocol: OracleProtocol
  connectionType: OracleConnectionType
  serviceName?: string
  sid?: string
  username: string
  password: string
  connectionTimeout?: number
  walletContent?: string
  walletPassword?: string
}

export interface OracleQueryParams extends OracleConnectionConfig {
  query: string
  binds?: OracleBinds
}

export interface OracleExecuteParams extends OracleConnectionConfig {
  query: string
  binds?: OracleBinds
}

export interface OracleInsertParams extends OracleConnectionConfig {
  schema?: string
  table: string
  data: Record<string, unknown>
}

export interface OracleUpdateParams extends OracleConnectionConfig {
  schema?: string
  table: string
  data: Record<string, unknown>
  where: string
}

export interface OracleDeleteParams extends OracleConnectionConfig {
  schema?: string
  table: string
  where: string
}

export interface OracleIntrospectParams extends OracleConnectionConfig {
  schema?: string
}

export interface OracleExecutionResponse extends ToolResponse {
  output: {
    message: string
    rows: unknown[]
    rowCount: number
    truncated?: boolean
    truncationReason?: string
  }
  error?: string
}

export interface OracleQueryResponse extends OracleExecutionResponse {}
export interface OracleExecuteResponse extends OracleExecutionResponse {}
export interface OracleInsertResponse extends OracleExecutionResponse {}
export interface OracleUpdateResponse extends OracleExecutionResponse {}
export interface OracleDeleteResponse extends OracleExecutionResponse {}

export interface OracleColumnReference {
  schema: string
  table: string
  column: string
}

export interface OracleTableColumn {
  name: string
  type: string
  nullable: boolean
  default: string | null
  isPrimaryKey: boolean
  isForeignKey: boolean
  references?: OracleColumnReference
}

export interface OracleForeignKey {
  column: string
  referencesSchema: string
  referencesTable: string
  referencesColumn: string
}

export interface OracleTableIndex {
  name: string
  columns: string[]
  unique: boolean
}

export interface OracleTableSchema {
  name: string
  schema: string
  columns: OracleTableColumn[]
  primaryKey: string[]
  foreignKeys: OracleForeignKey[]
  indexes: OracleTableIndex[]
}

export interface OracleIntrospectResponse extends ToolResponse {
  output: {
    message: string
    tables: OracleTableSchema[]
    schemas: string[]
  }
  error?: string
}

/** Shared output definition for Oracle query and execution operations. */
export const ORACLE_EXECUTION_OUTPUTS = {
  message: { type: 'string', description: 'Operation status message' },
  rows: {
    type: 'array',
    description: 'Normalized rows returned by the statement, when it produces a result set',
  },
  rowCount: { type: 'number', description: 'Number of rows returned or affected' },
  truncated: {
    type: 'boolean',
    description: 'True when rows were dropped to stay inside the row or byte ceiling',
    optional: true,
  },
  truncationReason: {
    type: 'string',
    description: 'The response ceiling that was reached',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/** Output definition for the columns returned by Oracle schema introspection. */
export const ORACLE_COLUMN_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Column name' },
  type: { type: 'string', description: 'Oracle data type, including length or precision' },
  nullable: { type: 'boolean', description: 'Whether the column allows NULL values' },
  default: { type: 'string', description: 'Default value expression', nullable: true },
  isPrimaryKey: { type: 'boolean', description: 'Whether the column is part of the primary key' },
  isForeignKey: { type: 'boolean', description: 'Whether the column is a foreign key' },
  references: {
    type: 'object',
    description: 'Cross-schema foreign key reference information',
    optional: true,
    properties: {
      schema: { type: 'string', description: 'Referenced schema name' },
      table: { type: 'string', description: 'Referenced table name' },
      column: { type: 'string', description: 'Referenced column name' },
    },
  },
} as const satisfies Record<string, OutputProperty>

/** Output definition for foreign key constraints returned by introspection. */
export const ORACLE_FOREIGN_KEY_OUTPUT_PROPERTIES = {
  column: { type: 'string', description: 'Local column name' },
  referencesSchema: { type: 'string', description: 'Referenced schema name' },
  referencesTable: { type: 'string', description: 'Referenced table name' },
  referencesColumn: { type: 'string', description: 'Referenced column name' },
} as const satisfies Record<string, OutputProperty>

/** Output definition for indexes returned by introspection. */
export const ORACLE_INDEX_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Index name' },
  columns: {
    type: 'array',
    description: 'Indexed columns in column-position order',
    items: { type: 'string', description: 'Column name' },
  },
  unique: { type: 'boolean', description: 'Whether the index is declared UNIQUE' },
} as const satisfies Record<string, OutputProperty>

/** Output definition for tables returned by Oracle schema introspection. */
export const ORACLE_TABLE_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Table name' },
  schema: { type: 'string', description: 'Owning Oracle schema' },
  columns: {
    type: 'array',
    description: 'Table columns in ordinal position order',
    items: { type: 'object', properties: ORACLE_COLUMN_OUTPUT_PROPERTIES },
  },
  primaryKey: {
    type: 'array',
    description: 'Primary key column names in constraint order',
    items: { type: 'string', description: 'Column name' },
  },
  foreignKeys: {
    type: 'array',
    description: 'Foreign key columns declared on the table',
    items: { type: 'object', properties: ORACLE_FOREIGN_KEY_OUTPUT_PROPERTIES },
  },
  indexes: {
    type: 'array',
    description: 'Non-primary-key indexes on the table',
    items: { type: 'object', properties: ORACLE_INDEX_OUTPUT_PROPERTIES },
  },
} as const satisfies Record<string, OutputProperty>
