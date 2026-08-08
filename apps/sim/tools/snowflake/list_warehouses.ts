import { buildListWarehouses } from '@/tools/snowflake/sql'
import type {
  SnowflakeListWarehousesParams,
  SnowflakeStatementResponse,
} from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeBaseParams,
  snowflakeMaxRowsParam,
  snowflakeStatementParams,
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
    ...snowflakeBaseParams,
    ...snowflakeStatementParams,
    ...snowflakeMaxRowsParam,
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
