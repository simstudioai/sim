import type {
  SnowflakeGetStatementParams,
  SnowflakeGetStatementResponse,
} from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  getSnowflakeHeaders,
  normalizeMaxRows,
  normalizeSnowflakeHost,
  snowflakeBaseParams,
  transformSnowflakeResponse,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

function partitionNumber(value?: number): number {
  const partition = value ?? 0
  if (!Number.isInteger(partition) || partition < 0) {
    throw new Error('partition must be a non-negative integer')
  }
  return partition
}

export const getStatementTool: ToolConfig<
  SnowflakeGetStatementParams,
  SnowflakeGetStatementResponse
> = {
  id: 'snowflake_get_statement',
  name: 'Snowflake Get Statement',
  description:
    'Check a running or completed statement and retrieve exactly one result partition. Canceled or failed statements are returned as errors.',
  version: '1.0.0',
  params: {
    ...snowflakeBaseParams,
    statementHandle: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Statement handle returned by Snowflake',
    },
    partition: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Zero-based result partition to retrieve; defaults to 0',
    },
    maxRows: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum rows returned from this partition, from 1 to 10000',
    },
  },
  request: {
    url: (params) => {
      const partition = partitionNumber(params.partition)
      normalizeMaxRows(params.maxRows)
      return `${normalizeSnowflakeHost(params.host)}/api/v2/statements/${encodeURIComponent(params.statementHandle.trim())}?partition=${partition}`
    },
    method: 'GET',
    headers: getSnowflakeHeaders,
  },
  transformResponse: (response, params) =>
    transformSnowflakeResponse(
      response,
      partitionNumber(params?.partition),
      params?.maxRows,
      false,
      params?.statementHandle.trim()
    ),
  outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
}
