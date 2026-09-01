import { buildLoadData } from '@/tools/snowflake/sql'
import type { SnowflakeLoadDataParams, SnowflakeStatementResponse } from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeAuthParamFields,
  snowflakeStatementRequest,
  transformSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * COPY INTO omits PURGE and FORCE entirely when the value is absent, which is how
 * Snowflake's FALSE defaults are inherited. A direct tool call can still supply the
 * string `"false"`, which is truthy, so only a real `true` or the exact string
 * `"true"` may enable an irreversible purge.
 */
function optionalCopyFlag(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return value === true || value === 'true'
}

export const loadDataTool: ToolConfig<SnowflakeLoadDataParams, SnowflakeStatementResponse> = {
  id: 'snowflake_load_data',
  version: '1.0.0',
  name: 'Snowflake Load Data',
  description: 'Load files from an existing Snowflake stage with COPY INTO.',
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
      description: 'Target database name',
    },
    schema: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Target schema name',
    },
    table: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Target table name',
    },
    stagePath: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Existing stage path, for example @my_stage/path',
    },
    fileFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional named file format',
    },
    pattern: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional regular expression used to select staged files',
    },
    onError: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'COPY error handling: ABORT_STATEMENT, CONTINUE, SKIP_FILE, SKIP_FILE_<count>, or SKIP_FILE_<percent>%',
    },
    purge: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Remove successfully loaded files from the stage',
    },
    force: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reload files even when Snowflake has loaded them before',
    },
    matchByColumnName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'CASE_SENSITIVE, CASE_INSENSITIVE, or NONE',
    },
  },
  request: snowflakeStatementRequest((params) =>
    buildSnowflakeStatementBody(
      params,
      buildLoadData({
        ...params,
        purge: optionalCopyFlag(params.purge),
        force: optionalCopyFlag(params.force),
      }),
      {
        warehouse: params.warehouse,
        maxRows: params.maxRows,
      }
    )
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
