import { buildResumeWarehouse } from '@/tools/snowflake/sql'
import type {
  SnowflakeResumeWarehouseResponse,
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

export const resumeWarehouseTool: ToolConfig<
  SnowflakeWarehouseParams,
  SnowflakeResumeWarehouseResponse
> = {
  id: 'snowflake_resume_warehouse',
  version: '1.0.0',
  name: 'Snowflake Resume Warehouse',
  description: 'Resume a Snowflake virtual warehouse if it is suspended.',
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
    body: (params) => buildSnowflakeStatementBody(params, buildResumeWarehouse(params)),
  },
  transformResponse: (response, params) => transformSnowflakeResponse(response, 0, params?.maxRows),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
