import type { ToolResponse } from '@/tools/types'

export interface AzureDataExplorerBaseParams {
  clusterUri: string
  tenantId: string
  clientId: string
  clientSecret: string
  resource?: string
}

export interface AzureDataExplorerColumn {
  name: string
  type: string | null
  dataType: string | null
}

/** Primary result table of a Kusto query or management command. */
export interface AzureDataExplorerTable {
  tableName: string | null
  columns: AzureDataExplorerColumn[]
  rows: unknown[][]
  records: Array<Record<string, unknown>>
  /** Rows carried in this payload, after the row cap. */
  rowCount: number
  /** Rows Kusto returned, before the row cap. */
  totalRowCount: number
  truncated: boolean
}

export interface AzureDataExplorerTableResponse extends ToolResponse {
  output: AzureDataExplorerTable
}

export interface AzureDataExplorerDatabaseListResponse extends ToolResponse {
  output: AzureDataExplorerTable & { databases: string[] }
}

export interface AzureDataExplorerTableListResponse extends ToolResponse {
  output: AzureDataExplorerTable & { tables: string[] }
}

export interface AzureDataExplorerIngestResponse extends ToolResponse {
  output: AzureDataExplorerTable & { extentIds: string[] }
}

export interface AzureDataExplorerTableSchemaResponse extends ToolResponse {
  output: {
    tableName: string | null
    schema: string | null
    databaseName: string | null
    folder: string | null
    docString: string | null
  }
}

export interface AzureDataExplorerQueryParams extends AzureDataExplorerBaseParams {
  database: string
  query: string
  properties?: Record<string, unknown> | string
  readOnly?: boolean
}

export interface AzureDataExplorerManagementParams extends AzureDataExplorerBaseParams {
  command: string
  database?: string
}

export interface AzureDataExplorerListDatabasesParams extends AzureDataExplorerBaseParams {}

export interface AzureDataExplorerListTablesParams extends AzureDataExplorerBaseParams {
  database: string
}

export interface AzureDataExplorerShowTableSchemaParams extends AzureDataExplorerBaseParams {
  database: string
  table: string
}

export interface AzureDataExplorerShowDatabaseSchemaParams extends AzureDataExplorerBaseParams {
  database: string
}

export interface AzureDataExplorerFunctionListResponse extends ToolResponse {
  output: AzureDataExplorerTable & { functions: string[] }
}

export interface AzureDataExplorerCreateTableParams extends AzureDataExplorerBaseParams {
  database: string
  table: string
  columnSchema: string
  tableProperties?: string
}

export interface AzureDataExplorerDropTableParams extends AzureDataExplorerBaseParams {
  database: string
  table: string
  ifExists?: boolean
}

export interface AzureDataExplorerIngestFromQueryParams extends AzureDataExplorerBaseParams {
  database: string
  table: string
  mode?: string
  sourceQuery: string
  async?: boolean
  ingestionProperties?: string
}

export interface AzureDataExplorerShowTableDetailsParams extends AzureDataExplorerBaseParams {
  database: string
  table?: string
}

export interface AzureDataExplorerShowIngestionFailuresParams extends AzureDataExplorerBaseParams {
  database: string
  operationId?: string
}

export interface AzureDataExplorerListFunctionsParams extends AzureDataExplorerBaseParams {
  database: string
}

export interface AzureDataExplorerShowOperationsParams extends AzureDataExplorerBaseParams {
  database?: string
  operationId?: string
}

export interface AzureDataExplorerIngestInlineParams extends AzureDataExplorerBaseParams {
  database: string
  table: string
  data: string
  ingestionProperties?: string
}
