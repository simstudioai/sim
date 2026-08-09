import { buildListSchemas } from '@/tools/snowflake/sql'
import type {
  SnowflakeListSchemasParams,
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

export const listSchemasTool: ToolConfig<SnowflakeListSchemasParams, SnowflakeStatementResponse> = {
  id: 'snowflake_list_schemas',
  version: '1.0.0',
  name: 'Snowflake List Schemas',
  description: 'List the schemas in a Snowflake database.',
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
    database: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Database name',
    },
    nameLike: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional SQL LIKE pattern for object names',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum rows, from 1 to 10000',
    },
  },
  request: snowflakeStatementRequest((params) =>
    buildSnowflakeStatementBody(params, buildListSchemas(params), { maxRows: params.limit })
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
