import { buildSuspendWarehouse } from '@/tools/snowflake/sql'
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

export const suspendWarehouseTool: ToolConfig<
  SnowflakeWarehouseParams,
  SnowflakeStatementResponse
> = {
  id: 'snowflake_suspend_warehouse',
  version: '1.0.0',
  name: 'Snowflake Suspend Warehouse',
  description: 'Suspend a Snowflake virtual warehouse.',
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
    buildSnowflakeStatementBody(params, buildSuspendWarehouse(params))
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
