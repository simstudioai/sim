import { buildGetWarehouse } from '@/tools/snowflake/sql'
import type { SnowflakeStatementResponse, SnowflakeWarehouseParams } from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeBaseParams,
  snowflakeStatementParams,
  snowflakeStatementRequest,
  transformSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

export const getWarehouseTool: ToolConfig<SnowflakeWarehouseParams, SnowflakeStatementResponse> = {
  id: 'snowflake_get_warehouse',
  version: '1.0.0',
  name: 'Snowflake Get Warehouse',
  description: 'Get the full details for a Snowflake virtual warehouse.',
  params: {
    ...snowflakeBaseParams,
    ...snowflakeStatementParams,
    warehouseName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Warehouse name',
    },
  },
  request: snowflakeStatementRequest((params) =>
    buildSnowflakeStatementBody(params, buildGetWarehouse(params), { maxRows: 1 })
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
