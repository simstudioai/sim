import { buildIntrospectSchema } from '@/tools/snowflake/sql'
import type {
  SnowflakeIntrospectSchemaParams,
  SnowflakeStatementResponse,
} from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeBaseParams,
  snowflakeComputeParams,
  snowflakeMaxRowsParam,
  snowflakeStatementRequest,
  transformSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

export const introspectSchemaTool: ToolConfig<
  SnowflakeIntrospectSchemaParams,
  SnowflakeStatementResponse
> = {
  id: 'snowflake_introspect_schema',
  version: '1.0.0',
  name: 'Snowflake Introspect Schema',
  description: 'Inspect table and column metadata through Snowflake INFORMATION_SCHEMA views.',
  params: {
    ...snowflakeBaseParams,
    ...snowflakeComputeParams,
    ...snowflakeMaxRowsParam,
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
  request: snowflakeStatementRequest((params) =>
    buildSnowflakeStatementBody(params, buildIntrospectSchema(params), {
      warehouse: params.warehouse,
      maxRows: params.maxRows,
    })
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
