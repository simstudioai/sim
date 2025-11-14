import type { ToolResponse } from '@/tools/types'

/**
 * Snowflake tool types and interfaces
 */

/**
 * Base parameters for Snowflake operations
 */
export interface SnowflakeBaseParams {
  accessToken: string
  accountUrl: string
}

/**
 * Parameters for executing a SQL query
 */
export interface SnowflakeExecuteQueryParams extends SnowflakeBaseParams {
  query: string
  database?: string
  schema?: string
  warehouse?: string
  role?: string
  timeout?: number
}

/**
 * Parameters for listing databases
 */
export interface SnowflakeListDatabasesParams extends SnowflakeBaseParams {
  warehouse?: string
  role?: string
}

/**
 * Parameters for listing schemas
 */
export interface SnowflakeListSchemasParams extends SnowflakeBaseParams {
  database: string
  warehouse?: string
  role?: string
}

/**
 * Parameters for listing tables
 */
export interface SnowflakeListTablesParams extends SnowflakeBaseParams {
  database: string
  schema: string
  warehouse?: string
  role?: string
}

/**
 * Parameters for describing a table
 */
export interface SnowflakeDescribeTableParams extends SnowflakeBaseParams {
  database: string
  schema: string
  table: string
  warehouse?: string
  role?: string
}

/**
 * Parameters for listing views
 */
export interface SnowflakeListViewsParams extends SnowflakeBaseParams {
  database: string
  schema: string
  warehouse?: string
  role?: string
}

/**
 * Parameters for listing warehouses
 */
export interface SnowflakeListWarehousesParams extends SnowflakeBaseParams {
  warehouse?: string
  role?: string
}

/**
 * Parameters for listing file formats
 */
export interface SnowflakeListFileFormatsParams extends SnowflakeBaseParams {
  database: string
  schema: string
  warehouse?: string
  role?: string
}

/**
 * Parameters for listing stages
 */
export interface SnowflakeListStagesParams extends SnowflakeBaseParams {
  database: string
  schema: string
  warehouse?: string
  role?: string
}

/**
 * Response for execute query operations
 */
export interface SnowflakeExecuteQueryResponse extends ToolResponse {
  output: {
    statementHandle?: string
    message?: string
    data?: any[]
    rowCount?: number
    columns?: Array<{
      name: string
      type: string
    }>
    ts: string
  }
}

/**
 * Response for list databases operation
 */
export interface SnowflakeListDatabasesResponse extends ToolResponse {
  output: {
    databases?: Array<{
      name: string
      created_on: string
      owner: string
    }>
    ts: string
  }
}

/**
 * Response for list schemas operation
 */
export interface SnowflakeListSchemasResponse extends ToolResponse {
  output: {
    schemas?: Array<{
      name: string
      database_name: string
      created_on: string
      owner: string
    }>
    ts: string
  }
}

/**
 * Response for list tables operation
 */
export interface SnowflakeListTablesResponse extends ToolResponse {
  output: {
    tables?: Array<{
      name: string
      database_name: string
      schema_name: string
      kind: string
      created_on: string
      row_count: number
    }>
    ts: string
  }
}

/**
 * Response for describe table operation
 */
export interface SnowflakeDescribeTableResponse extends ToolResponse {
  output: {
    columns?: Array<{
      name: string
      type: string
      kind: string
      null: string
      default: string | null
      primary_key: string
      unique_key: string
      check: string | null
      expression: string | null
      comment: string | null
    }>
    ts: string
  }
}

/**
 * Response for list views operation
 */
export interface SnowflakeListViewsResponse extends ToolResponse {
  output: {
    views?: Array<{
      name: string
      database_name: string
      schema_name: string
      created_on: string
      owner: string
    }>
    ts: string
  }
}

/**
 * Response for list warehouses operation
 */
export interface SnowflakeListWarehousesResponse extends ToolResponse {
  output: {
    warehouses?: Array<{
      name: string
      state: string
      size: string
      created_on: string
      owner: string
    }>
    ts: string
  }
}

/**
 * Response for list file formats operation
 */
export interface SnowflakeListFileFormatsResponse extends ToolResponse {
  output: {
    fileFormats?: Array<{
      name: string
      type: string
      owner: string
      created_on: string
    }>
    ts: string
  }
}

/**
 * Response for list stages operation
 */
export interface SnowflakeListStagesResponse extends ToolResponse {
  output: {
    stages?: Array<{
      name: string
      type: string
      url: string
      created_on: string
      owner: string
    }>
    ts: string
  }
}

/**
 * Generic Snowflake response type for the block
 */
export type SnowflakeResponse =
  | SnowflakeExecuteQueryResponse
  | SnowflakeListDatabasesResponse
  | SnowflakeListSchemasResponse
  | SnowflakeListTablesResponse
  | SnowflakeDescribeTableResponse
  | SnowflakeListViewsResponse
  | SnowflakeListWarehousesResponse
  | SnowflakeListFileFormatsResponse
  | SnowflakeListStagesResponse
