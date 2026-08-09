import { buildUnloadData } from '@/tools/snowflake/sql'
import type { SnowflakeStatementResponse, SnowflakeUnloadDataParams } from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  snowflakeAuthParamFields,
  snowflakeStatementRequest,
  transformSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

export const unloadDataTool: ToolConfig<SnowflakeUnloadDataParams, SnowflakeStatementResponse> = {
  id: 'snowflake_unload_data',
  version: '1.0.0',
  name: 'Snowflake Unload Data',
  description: 'Export a Snowflake table to files in a stage with COPY INTO.',
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
      description: 'Database name',
    },
    schema: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Schema name',
    },
    stagePath: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Destination stage reference, for example @EXPORTS/daily',
    },
    table: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Source table to unload. To export a query result, materialize it first as a view or with CREATE TABLE AS SELECT, then unload that',
    },
    fileFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Named file format applied to the unloaded files',
    },
    header: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether to write column headings into the unloaded files; supported for CSV and Parquet only',
    },
    overwrite: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to replace existing files with matching names in the stage',
    },
    singleFile: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to write one file instead of splitting the output across files',
    },
    maxFileSizeBytes: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Upper size limit per unloaded file in bytes; Snowflake defaults to 16777216 (16 MB) and allows up to 5368709120 (5 GB)',
    },
  },
  request: snowflakeStatementRequest((params) =>
    buildSnowflakeStatementBody(params, buildUnloadData(params), {
      context: { database: params.database, schema: params.schema },
      warehouse: params.warehouse,
      maxRows: params.maxRows,
    })
  ),
  transformResponse: transformSnowflakeResult(),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
