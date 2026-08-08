import { buildListWarehouses } from '@/tools/snowflake/sql'
import type {
  SnowflakeListWarehousesParams,
  SnowflakeListWarehousesResponse,
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

export const listWarehousesTool: ToolConfig<
  SnowflakeListWarehousesParams,
  SnowflakeListWarehousesResponse
> = {
  id: 'snowflake_list_warehouses',
  version: '1.0.0',
  name: 'Snowflake List Warehouses',
  description: 'List warehouses visible to the active Snowflake role.',
  params: {
    ...snowflakeBaseParams,
    ...snowflakeContextParams,
    nameLike: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional SQL LIKE pattern for warehouse names',
    },
  },
  request: {
    url: (params) => `${normalizeSnowflakeHost(params.host)}/api/v2/statements`,
    method: 'POST',
    headers: getSnowflakeHeaders,
    body: (params) => buildSnowflakeStatementBody(params, buildListWarehouses(params.nameLike)),
  },
  transformResponse: (response, params) => transformSnowflakeResponse(response, 0, params?.maxRows),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
