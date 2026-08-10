import { buildSuspendWarehouse } from '@/tools/snowflake/sql'
import type { SnowflakeStatementResponse, SnowflakeWarehouseParams } from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeAuthParamFields,
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
    ...snowflakeAuthParamFields,
    role: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Snowflake role to use for this statement',
    },
    statementTimeoutSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Statement timeout in seconds; 0 uses Snowflake maximum of 604800 seconds',
    },
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
