import type {
  DatabricksExecuteSqlResponse,
  DatabricksGetStatementParams,
} from '@/tools/databricks/types'
import { GENIE_QUERY_RESULT_OUTPUTS } from '@/tools/databricks/types'
import {
  databricksUrl,
  mapStatementResult,
  optionalDatabricksString,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getStatementTool: ToolConfig<
  DatabricksGetStatementParams,
  DatabricksExecuteSqlResponse
> = {
  id: 'databricks_get_statement',
  name: 'Databricks Get Statement',
  description:
    'Poll a SQL statement by its ID to retrieve status and results. Use this after Execute SQL when a query runs longer than the wait timeout.',
  version: '1.0.0',

  params: {
    host: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Databricks workspace host (e.g., dbc-abc123.cloud.databricks.com)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Databricks Personal Access Token',
    },
    warehouseId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SQL warehouse identifier, when required by the statement endpoint',
    },
    statementId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the statement to fetch (returned by Execute SQL)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        databricksUrl(
          params.host,
          `/api/2.0/sql/statements/${safeUrlPathSegment(params.statementId, 'statementId')}`
        )
      )
      const warehouseId = optionalDatabricksString(params.warehouseId)
      if (warehouseId) url.searchParams.set('warehouse_id', warehouseId)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error?.message || 'Failed to get statement')
    }

    return { success: true, output: mapStatementResult(data) }
  },

  outputs: GENIE_QUERY_RESULT_OUTPUTS,
}
