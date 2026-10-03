import { buildListWarehouses } from '@/tools/snowflake/sql'
import type {
  SnowflakeListWarehousesParams,
  SnowflakeStatementResponse,
} from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeAuthParamFields,
  snowflakeStatementRequest,
  transformSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

export const listWarehousesTool: ToolConfig<
  SnowflakeListWarehousesParams,
  SnowflakeStatementResponse
> = {
  id: 'snowflake_list_warehouses',
  version: '1.0.0',
  name: 'Snowflake List Warehouses',
  description: 'List warehouses visible to the active Snowflake role.',
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
    maxRows: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum result rows; defaults to 1000 with a Sim safety limit of 10000',
    },
    nameLike: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional SQL LIKE pattern for warehouse names',
    },
  },
  request: snowflakeStatementRequest((params) =>
    buildSnowflakeStatementBody(params, buildListWarehouses(params.nameLike), {
      maxRows: params.maxRows,
    })
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
