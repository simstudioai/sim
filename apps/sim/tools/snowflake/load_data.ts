import { buildLoadData } from '@/tools/snowflake/sql'
import type { SnowflakeLoadDataParams, SnowflakeLoadDataResponse } from '@/tools/snowflake/types'
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

export const loadDataTool: ToolConfig<SnowflakeLoadDataParams, SnowflakeLoadDataResponse> = {
  id: 'snowflake_load_data',
  version: '1.0.0',
  name: 'Snowflake Load Data',
  description: 'Load files from an existing Snowflake stage with COPY INTO.',
  params: {
    ...snowflakeBaseParams,
    ...snowflakeContextParams,
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
  request: {
    url: (params) => `${normalizeSnowflakeHost(params.host)}/api/v2/statements`,
    method: 'POST',
    headers: getSnowflakeHeaders,
    body: (params) => buildSnowflakeStatementBody(params, buildLoadData(params)),
  },
  transformResponse: (response, params) => transformSnowflakeResponse(response, 0, params?.maxRows),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
