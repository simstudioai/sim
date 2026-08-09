import { buildAlterWarehouse } from '@/tools/snowflake/sql'
import type {
  SnowflakeAlterWarehouseParams,
  SnowflakeStatementResponse,
} from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS, SNOWFLAKE_WAREHOUSE_SIZES } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeAuthParamFields,
  snowflakeStatementRequest,
  transformSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

export const alterWarehouseTool: ToolConfig<
  SnowflakeAlterWarehouseParams,
  SnowflakeStatementResponse
> = {
  id: 'snowflake_alter_warehouse',
  version: '1.0.0',
  name: 'Snowflake Alter Warehouse',
  description: 'Resize a Snowflake warehouse or change its auto-suspend and auto-resume settings.',
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
    warehouseSize: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: `New warehouse size, one of ${SNOWFLAKE_WAREHOUSE_SIZES.join(', ')}`,
    },
    autoSuspendSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Seconds of inactivity before the warehouse suspends. Snowflake polls every 30 seconds, so values under 30 or not a multiple of 30 may not behave as expected. 0 means the warehouse never suspends and keeps consuming credits',
    },
    autoResume: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the warehouse resumes automatically when a statement is submitted',
    },
  },
  request: snowflakeStatementRequest((params) =>
    buildSnowflakeStatementBody(params, buildAlterWarehouse(params))
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
