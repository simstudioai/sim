import type {
  DatabricksGetWarehouseParams,
  DatabricksGetWarehouseResponse,
} from '@/tools/databricks/types'
import { WAREHOUSE_OUTPUT_PROPERTIES } from '@/tools/databricks/types'
import {
  DATABRICKS_AUTH_PARAMS,
  databricksUrl,
  mapWarehouse,
  readDatabricksError,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getWarehouseTool: ToolConfig<
  DatabricksGetWarehouseParams,
  DatabricksGetWarehouseResponse
> = {
  id: 'databricks_get_warehouse',
  name: 'Databricks Get Warehouse',
  description: 'Get the configuration, state, and scaling settings of a SQL warehouse.',
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
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey}`, Accept: 'application/json' }),
  },
  transformResponse: async (response) => {
    if (!response.ok)
      throw new Error(await readDatabricksError(response, 'Failed to get SQL warehouse'))
    return { success: true, output: { warehouse: mapWarehouse(await response.json()) } }
  },
  outputs: {
    warehouse: {
      type: 'object',
      description: 'SQL warehouse configuration and state',
      properties: WAREHOUSE_OUTPUT_PROPERTIES,
    },
  },
}
