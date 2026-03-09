import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Output property definitions for PostgreSQL introspection and query responses.
 * @see https://www.postgresql.org/docs/current/information-schema.html
 */

/**
 * Output definition for table column objects from introspection.
 * @see https://www.postgresql.org/docs/current/infoschema-columns.html
 */
export const POSTGRES_COLUMN_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Column name' },
  type: { type: 'string', description: 'Data type (e.g., integer, varchar, timestamp)' },
  nullable: { type: 'boolean', description: 'Whether the column allows NULL values' },
  default: { type: 'string', description: 'Default value expression', optional: true },
  isPrimaryKey: { type: 'boolean', description: 'Whether the column is part of the primary key' },
  isForeignKey: { type: 'boolean', description: 'Whether the column is a foreign key' },
  references: {
    type: 'object',
    description: 'Foreign key reference information',
    optional: true,
    properties: {
      table: { type: 'string', description: 'Referenced table name' },
      column: { type: 'string', description: 'Referenced column name' },
    },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete column output definition
 */
export const POSTGRES_COLUMN_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'PostgreSQL table column',
  properties: POSTGRES_COLUMN_OUTPUT_PROPERTIES,
}

/**
 * Output definition for foreign key constraint objects.
 */
export const POSTGRES_FOREIGN_KEY_OUTPUT_PROPERTIES = {
  column: { type: 'string', description: 'Local column name' },
  referencesTable: { type: 'string', description: 'Referenced table name' },
  referencesColumn: { type: 'string', description: 'Referenced column name' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for index objects.
 * @see https://www.postgresql.org/docs/current/catalog-pg-index.html
 */
export const POSTGRES_INDEX_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Index name' },
  columns: {
    type: 'array',
    description: 'Columns included in the index',
    items: { type: 'string', description: 'Column name' },
  },
  unique: { type: 'boolean', description: 'Whether the index enforces uniqueness' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for table schema objects from introspection.
 */
export const POSTGRES_TABLE_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Table name' },
  schema: { type: 'string', description: 'Schema name (e.g., public)' },
  columns: {
    type: 'array',
    description: 'Table columns',
    items: {
      type: 'object',
      properties: POSTGRES_COLUMN_OUTPUT_PROPERTIES,
    },
  },
  primaryKey: {
    type: 'array',
    description: 'Primary key column names',
    items: { type: 'string', description: 'Column name' },
  },
  foreignKeys: {
    type: 'array',
    description: 'Foreign key constraints',
    items: {
      type: 'object',
      properties: POSTGRES_FOREIGN_KEY_OUTPUT_PROPERTIES,
    },
  },
  indexes: {
    type: 'array',
    description: 'Table indexes',
    items: {
      type: 'object',
      properties: POSTGRES_INDEX_OUTPUT_PROPERTIES,
    },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete table schema output definition
 */
export const POSTGRES_TABLE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'PostgreSQL table schema information',
  properties: POSTGRES_TABLE_OUTPUT_PROPERTIES,
}

export interface PostgresConnectionConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
  ssl: 'disabled' | 'required' | 'preferred'
}

export interface PostgresQueryParams extends PostgresConnectionConfig {
  query: string
}

export interface PostgresInsertParams extends PostgresConnectionConfig {
  table: string
  data: Record<string, unknown>
}

export interface PostgresUpdateParams extends PostgresConnectionConfig {
  table: string
  data: Record<string, unknown>
  where: string
}

export interface PostgresDeleteParams extends PostgresConnectionConfig {
  table: string
  where: string
}

export interface PostgresExecuteParams extends PostgresConnectionConfig {
  query: string
}

export interface PostgresIntrospectParams extends PostgresConnectionConfig {
  schema?: string
}

export interface PostgresBaseResponse extends ToolResponse {
  output: {
    message: string
    rows: unknown[]
    rowCount: number
  }
  error?: string
}

export interface PostgresQueryResponse extends PostgresBaseResponse {}
export interface PostgresInsertResponse extends PostgresBaseResponse {}
export interface PostgresUpdateResponse extends PostgresBaseResponse {}
export interface PostgresDeleteResponse extends PostgresBaseResponse {}
export interface PostgresExecuteResponse extends PostgresBaseResponse {}

export interface TableColumn {
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

export interface TableSchema {
  name: string
  schema: string
  columns: TableColumn[]
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

export interface PostgresIntrospectResponse extends ToolResponse {
  output: {
    message: string
    tables: TableSchema[]
    schemas: string[]
  }
  error?: string
}

export interface PostgresResponse extends PostgresBaseResponse {}
