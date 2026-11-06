import type {
  DatabricksDeleteWarehouseParams,
  DatabricksSuccessResponse,
} from '@/tools/databricks/types'
import {
  DATABRICKS_AUTH_PARAMS,
  databricksUrl,
  readDatabricksError,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const deleteWarehouseTool: ToolConfig<
  DatabricksDeleteWarehouseParams,
  DatabricksSuccessResponse
> = {
  id: 'databricks_delete_warehouse',
  name: 'Databricks Delete Warehouse',
  description: 'Delete a SQL warehouse.',
  version: '1.0.0',
  params: {
    ...DATABRICKS_AUTH_PARAMS,
    warehouseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'SQL warehouse identifier',
    },
  },
  request: {
    url: (params) =>
      databricksUrl(
        params.host,
        `/api/2.0/sql/warehouses/${safeUrlPathSegment(params.warehouseId, 'warehouseId')}`
      ),
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },
  transformResponse: async (response) => {
    if (!response.ok)
      throw new Error(await readDatabricksError(response, 'Failed to delete warehouse'))
    return { success: true, output: { success: true } }
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether Databricks accepted the request' },
  },
}
