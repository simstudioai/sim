import { buildGetWarehouse } from '@/tools/snowflake/sql'
import type {
  SnowflakeGetWarehouseResponse,
  SnowflakeWarehouseParams,
} from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  getSnowflakeHeaders,
  normalizeSnowflakeHost,
  snowflakeBaseParams,
  snowflakeContextParams,
  transformSnowflakeResponse,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

export const getWarehouseTool: ToolConfig<SnowflakeWarehouseParams, SnowflakeGetWarehouseResponse> =
  {
    id: 'snowflake_get_warehouse',
    version: '1.0.0',
    name: 'Snowflake Get Warehouse',
    description: 'Get the full details for a Snowflake virtual warehouse.',
    params: {
      ...snowflakeBaseParams,
      ...snowflakeContextParams,
      warehouseName: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Warehouse name',
      },
    },
    request: {
      url: (params) => `${normalizeSnowflakeHost(params.host)}/api/v2/statements`,
      method: 'POST',
      headers: getSnowflakeHeaders,
      body: (params) => buildSnowflakeStatementBody(params, buildGetWarehouse(params)),
    },
    transformResponse: (response, params) =>
      transformSnowflakeResponse(response, 0, params?.maxRows),
    outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
  }
