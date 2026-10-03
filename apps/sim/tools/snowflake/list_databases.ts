import { buildListDatabases } from '@/tools/snowflake/sql'
import type {
  SnowflakeListDatabasesParams,
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

export const listDatabasesTool: ToolConfig<
  SnowflakeListDatabasesParams,
  SnowflakeStatementResponse
> = {
  id: 'snowflake_list_databases',
  version: '1.0.0',
  name: 'Snowflake List Databases',
  description: 'List the databases the credential can access.',
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
    buildSnowflakeStatementBody(params, buildListDatabases(params), { maxRows: params.limit })
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
