import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Connection fields accepted by every Microsoft SQL Server tool.
 * `encrypt` and `trustServerCertificate` map onto the Tedious driver's
 * `options.encrypt` / `options.trustServerCertificate` booleans.
 * @see https://github.com/tediousjs/node-mssql#tedious
 */
export interface MSSQLConnectionConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
  encrypt: 'enabled' | 'disabled'
  trustServerCertificate: 'enabled' | 'disabled'
  connectionTimeout?: number
}

export interface MSSQLQueryParams extends MSSQLConnectionConfig {
  query: string
}

export interface MSSQLExecuteParams extends MSSQLConnectionConfig {
  query: string
}

export interface MSSQLInsertParams extends MSSQLConnectionConfig {
  table: string
  data: Record<string, unknown>
}

export interface MSSQLUpdateParams extends MSSQLConnectionConfig {
  table: string
  data: Record<string, unknown>
  where: string
}

export interface MSSQLDeleteParams extends MSSQLConnectionConfig {
  table: string
  where: string
}

export interface MSSQLIntrospectParams extends MSSQLConnectionConfig {
  schema?: string
}

interface MSSQLBaseResponse extends ToolResponse {
  output: {
    message: string
    rows: unknown[]
    rowCount: number
    /**
     * Present only when the route dropped rows to stay inside its row and byte
     * ceilings. Absent means `rows` is the whole recordset.
     */
    truncated?: boolean
    truncationReason?: string
  }
  error?: string
}

export interface MSSQLQueryResponse extends MSSQLBaseResponse {}
export interface MSSQLExecuteResponse extends MSSQLBaseResponse {}
export interface MSSQLInsertResponse extends MSSQLBaseResponse {}
export interface MSSQLUpdateResponse extends MSSQLBaseResponse {}
export interface MSSQLDeleteResponse extends MSSQLBaseResponse {}
export interface MSSQLResponse extends MSSQLBaseResponse {}

interface MSSQLTableColumn {
  name: string
  type: string
  nullable: boolean
  default: string | null
  isPrimaryKey: boolean
  isForeignKey: boolean
  references?: { schema: string; table: string; column: string }
}

interface MSSQLTableSchema {
  name: string
  schema: string
  columns: MSSQLTableColumn[]
  primaryKey: string[]
  foreignKeys: Array<{
    column: string
    referencesSchema: string
    referencesTable: string
    referencesColumn: string
  }>
  indexes: Array<{ name: string; columns: string[]; unique: boolean }>
}

/**
 * Output definition for the column objects introspection returns. Unlike the
 * PostgreSQL sibling, a SQL Server foreign key reference carries its own schema,
 * since a database holds many schemas that a key can cross.
 * @see https://learn.microsoft.com/en-us/sql/relational-databases/system-information-schema-views/columns-transact-sql
 */
export const MSSQL_COLUMN_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Column name' },
  type: { type: 'string', description: 'Data type (e.g., int, nvarchar, datetime2)' },
  nullable: { type: 'boolean', description: 'Whether the column allows NULL values' },
  default: { type: 'string', description: 'Default value expression', optional: true },
  isPrimaryKey: { type: 'boolean', description: 'Whether the column is part of the primary key' },
  isForeignKey: { type: 'boolean', description: 'Whether the column is a foreign key' },
  references: {
    type: 'object',
    description: 'Foreign key reference information',
    optional: true,
    properties: {
      schema: { type: 'string', description: 'Referenced schema name' },
      table: { type: 'string', description: 'Referenced table name' },
      column: { type: 'string', description: 'Referenced column name' },
    },
  },
} as const satisfies Record<string, OutputProperty>

/** Output definition for foreign key constraint objects. */
export const MSSQL_FOREIGN_KEY_OUTPUT_PROPERTIES = {
  column: { type: 'string', description: 'Local column name' },
  referencesSchema: { type: 'string', description: 'Referenced schema name' },
  referencesTable: { type: 'string', description: 'Referenced table name' },
  referencesColumn: { type: 'string', description: 'Referenced column name' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for index objects. Primary keys are reported through
 * `primaryKey` instead, so they are absent here.
 * @see https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-indexes-transact-sql
 */
export const MSSQL_INDEX_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Index name' },
  columns: {
    type: 'array',
    description: 'Key columns included in the index, in key order',
    items: { type: 'string', description: 'Column name' },
  },
  unique: { type: 'boolean', description: 'Whether the index enforces uniqueness' },
} as const satisfies Record<string, OutputProperty>

/** Output definition for the table schema objects introspection returns. */
export const MSSQL_TABLE_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Table name' },
  schema: { type: 'string', description: 'Schema name (e.g., dbo)' },
  columns: {
    type: 'array',
    description: 'Table columns in ordinal position order',
    items: { type: 'object', properties: MSSQL_COLUMN_OUTPUT_PROPERTIES },
  },
  primaryKey: {
    type: 'array',
    description: 'Primary key column names, in key order',
    items: { type: 'string', description: 'Column name' },
  },
  foreignKeys: {
    type: 'array',
    description: 'Foreign key constraints declared on this table',
    items: { type: 'object', properties: MSSQL_FOREIGN_KEY_OUTPUT_PROPERTIES },
  },
  indexes: {
    type: 'array',
    description: 'Non-primary-key rowstore indexes on this table',
    items: { type: 'object', properties: MSSQL_INDEX_OUTPUT_PROPERTIES },
  },
} as const satisfies Record<string, OutputProperty>

export interface MSSQLIntrospectResponse extends ToolResponse {
  output: { message: string; tables: MSSQLTableSchema[]; schemas: string[] }
  error?: string
}
