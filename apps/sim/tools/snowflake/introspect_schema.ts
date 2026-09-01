import { buildIntrospectSchema } from '@/tools/snowflake/sql'
import type {
  SnowflakeIntrospectSchemaParams,
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

/**
 * Only a real `true` or the exact string `"true"` drops the TABLE_TYPE filter, so a
 * direct tool call supplying the truthy string `"false"` still excludes views.
 */
function includesViews(value: unknown): boolean {
  return value === true || value === 'true'
}

export const introspectSchemaTool: ToolConfig<
  SnowflakeIntrospectSchemaParams,
  SnowflakeStatementResponse
> = {
  id: 'snowflake_introspect_schema',
  version: '1.0.0',
  name: 'Snowflake Introspect Schema',
  description: 'Inspect table and column metadata through Snowflake INFORMATION_SCHEMA views.',
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
    warehouse: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Warehouse to use for this statement; defaults to the PAT user setting',
    },
    maxRows: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum result rows; defaults to 1000 with a Sim safety limit of 10000',
    },
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
      description: 'Include views and materialized views alongside tables',
    },
  },
  request: snowflakeStatementRequest((params) =>
    buildSnowflakeStatementBody(
      params,
      buildIntrospectSchema({ ...params, includeViews: includesViews(params.includeViews) }),
      {
        warehouse: params.warehouse,
        maxRows: params.maxRows,
      }
    )
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
