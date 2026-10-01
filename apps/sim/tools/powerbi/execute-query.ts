import { toStringOrNull } from '@sim/utils/coerce'
import {
  POWERBI_INFORMATION_PROTECTION_LABEL_OUTPUT_PROPERTIES,
  POWERBI_QUERY_ERROR_OUTPUT_PROPERTIES,
  type PowerBIExecuteQueryParams,
  type PowerBIExecuteQueryResponse,
  type PowerBIQueryError,
} from '@/tools/powerbi/types'
import {
  appendPowerBIQueryError,
  POWERBI_ACCESS_TOKEN_PARAM,
  POWERBI_DATASET_ID_PARAM,
  POWERBI_GROUP_ID_PARAM,
  powerBIHeaders,
  powerBIOptionalArray,
  powerBIRecord,
  powerBIUrl,
  readPowerBIJson,
} from '@/tools/powerbi/utils'
import type { ToolConfig } from '@/tools/types'

export const powerbiExecuteQueryTool: ToolConfig<
  PowerBIExecuteQueryParams,
  PowerBIExecuteQueryResponse
> = {
  id: 'powerbi_execute_query',
  name: 'Power BI Execute DAX Query',
  description: `Execute one DAX query returning one table from a semantic model. Requires workspace access, Read and Build permissions, and the tenant Dataset Execute Queries REST API setting. Power BI limits each query to 100,000 rows or 1,000,000 values, 15 MB of data, and 120 requests per minute per user. Dynamic column names are preserved. Any reported query error fails the action, including errors returned with HTTP 200. Connect the block's error port to handle its standard error output. Failed workflow outputs omit query fields, including partial rows, errors, and incomplete; successful queries expose the declared outputs. Direct tool responses retain available partial rows and typed errors, but downstream workflow blocks cannot access them after failure. See the [Execute Queries documentation](https://learn.microsoft.com/en-us/rest/api/power-bi/datasets/execute-queries-in-group).`,
  version: '1.0.0',
  errorExtractor: 'nested-error-object',
  oauth: { required: true, provider: 'microsoft-powerbi' },
  params: {
    accessToken: POWERBI_ACCESS_TOKEN_PARAM,
    groupId: POWERBI_GROUP_ID_PARAM,
    datasetId: POWERBI_DATASET_ID_PARAM,
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'One DAX query returning one table, for example EVALUATE TOPN(10, Sales)',
    },
    includeNulls: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      default: true,
      description: 'Include blank values in returned rows; defaults to true',
    },
  },
  request: {
    url: (params) =>
      powerBIUrl(['groups', params.groupId, 'datasets', params.datasetId, 'executeQueries']),
    method: 'POST',
    headers: (params) => powerBIHeaders(params.accessToken),
    body: (params) => {
      if (typeof params.query !== 'string' || !params.query.trim())
        throw new Error('DAX query is required')
      if (params.includeNulls !== undefined && typeof params.includeNulls !== 'boolean') {
        throw new Error('includeNulls must be a boolean')
      }
      return {
        queries: [{ query: params.query }],
        serializerSettings: { includeNulls: params.includeNulls ?? true },
      }
    },
  },
  transformResponse: async (response, _params, context) => {
    const data = powerBIRecord(await readPowerBIJson(response, context?.signal), 'query response')
    const rows: Record<string, unknown>[] = []
    const errors: PowerBIQueryError[] = []
    const results = powerBIOptionalArray(data.results, 'query result list')
    let tableCount = 0
    appendPowerBIQueryError(errors, data.error, 'response')
    for (const value of results) {
      const result = powerBIRecord(value, 'query result')
      appendPowerBIQueryError(errors, result.error, 'query')
      const tables = powerBIOptionalArray(result.tables, 'query table list')
      tableCount += tables.length
      for (const value of tables) {
        const table = powerBIRecord(value, 'query table')
        appendPowerBIQueryError(errors, table.error, 'table')
        for (const value of powerBIOptionalArray(table.rows, 'query rows'))
          rows.push(powerBIRecord(value, 'query row'))
      }
    }
    if (errors.length === 0 && (results.length !== 1 || tableCount !== 1)) {
      throw new Error(
        'Invalid Power BI execute-query response: expected one query result and one table'
      )
    }
    const label =
      data.informationProtectionLabel == null
        ? null
        : powerBIRecord(data.informationProtectionLabel, 'information protection label')
    const output = {
      rows,
      rowCount: rows.length,
      errors,
      incomplete: errors.length > 0,
      informationProtectionLabel: label
        ? { id: toStringOrNull(label.id), name: toStringOrNull(label.name) }
        : null,
    }
    if (errors.length > 0) {
      return {
        success: false,
        retryable: false,
        error: errors
          .map((error) => error.message ?? error.code ?? 'Power BI reported a query error')
          .join('; '),
        output,
      }
    }
    return { success: true, output }
  },
  outputs: {
    rows: {
      type: 'array',
      description: 'Returned query rows, preserving provider column keys',
      items: { type: 'object' },
    },
    rowCount: { type: 'number', description: 'Number of rows returned' },
    errors: {
      type: 'array',
      description: 'Errors reported at response, query, or table scope',
      items: { type: 'object', properties: POWERBI_QUERY_ERROR_OUTPUT_PROPERTIES },
    },
    incomplete: {
      type: 'boolean',
      description:
        'Whether the provider reported an embedded error; false does not guarantee an unlimited result',
    },
    informationProtectionLabel: {
      type: 'object',
      nullable: true,
      description: 'Information protection label, when supplied',
      properties: POWERBI_INFORMATION_PROTECTION_LABEL_OUTPUT_PROPERTIES,
    },
  },
}
