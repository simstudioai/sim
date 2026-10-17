import { filterUndefined } from '@sim/utils/object'
import type {
  DatabricksGetStatementParams,
  DatabricksSuccessResponse,
} from '@/tools/databricks/types'
import {
  DATABRICKS_AUTH_PARAMS,
  databricksUrl,
  optionalDatabricksString,
  readDatabricksError,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const cancelStatementTool: ToolConfig<
  DatabricksGetStatementParams,
  DatabricksSuccessResponse
> = {
  id: 'databricks_cancel_statement',
  name: 'Databricks Cancel Statement',
  description:
    'Request cancellation of an executing SQL statement; poll Get Statement to confirm its final status.',
  version: '1.0.0',
  params: {
    ...DATABRICKS_AUTH_PARAMS,
    statementId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'SQL statement identifier',
    },
    warehouseId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SQL warehouse identifier, when required by the statement endpoint',
    },
  },
  request: {
    url: (params) =>
      databricksUrl(
        params.host,
        `/api/2.0/sql/statements/${safeUrlPathSegment(params.statementId, 'statementId')}/cancel`
      ),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) =>
      filterUndefined({ warehouse_id: optionalDatabricksString(params.warehouseId) }),
  },
  transformResponse: async (response) => {
    if (!response.ok)
      throw new Error(await readDatabricksError(response, 'Failed to cancel SQL statement'))
    return { success: true, output: { success: true } }
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether the cancellation request was accepted' },
  },
}
