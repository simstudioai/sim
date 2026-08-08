import { buildIntrospectSchema } from '@/tools/snowflake/sql'
import type {
  SnowflakeIntrospectSchemaParams,
  SnowflakeIntrospectSchemaResponse,
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

export const introspectSchemaTool: ToolConfig<
  SnowflakeIntrospectSchemaParams,
  SnowflakeIntrospectSchemaResponse
> = {
  id: 'snowflake_introspect_schema',
  version: '1.0.0',
  name: 'Snowflake Introspect Schema',
  description: 'Inspect table and column metadata through Snowflake INFORMATION_SCHEMA views.',
  params: {
    ...snowflakeBaseParams,
    ...snowflakeContextParams,
    database: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Database containing the INFORMATION_SCHEMA views',
    },
    schema: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional exact schema name filter',
    },
    table: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional exact table name filter',
    },
    includeViews: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include views as well as base tables',
    },
  },
  request: {
    url: (params) => `${normalizeSnowflakeHost(params.host)}/api/v2/statements`,
    method: 'POST',
    headers: getSnowflakeHeaders,
    body: (params) => buildSnowflakeStatementBody(params, buildIntrospectSchema(params)),
  },
  transformResponse: (response, params) => transformSnowflakeResponse(response, 0, params?.maxRows),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
