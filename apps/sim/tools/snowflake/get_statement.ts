import type {
  SnowflakeGetStatementParams,
  SnowflakeStatementResponse,
} from '@/tools/snowflake/types'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  getSnowflakeBaseUrl,
  getSnowflakeHeaders,
  snowflakeAuthParamFields,
  transformSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

function partitionNumber(value?: number): number {
  const partition = value ?? 0
  if (!Number.isInteger(partition) || partition < 0) {
    throw new Error('partition must be a non-negative integer')
  }
  return partition
}

/**
 * Snowflake attaches result metadata only to the first partition's response, so the
 * partition count has to be carried forward by the caller to make a later partition's
 * continuation state knowable.
 */
function partitionCountNumber(value?: number): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('partitionCount must be a positive integer')
  }
  return value
}

export const getStatementTool: ToolConfig<SnowflakeGetStatementParams, SnowflakeStatementResponse> =
  {
    id: 'snowflake_get_statement',
    name: 'Snowflake Get Statement',
    description:
      'Check a running or completed statement and retrieve exactly one result partition. Canceled or failed statements are returned as errors.',
    version: '1.0.0',
    params: {
      ...snowflakeAuthParamFields,
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
      partitionCount: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Total number of result partitions, taken from the partitionCount of the first partition. Snowflake omits metadata from every later partition response, so supply this when fetching partition 1 or higher to keep truncated and nextPartition accurate',
      },
    },
    request: {
      url: (params) => {
        const partition = partitionNumber(params.partition)
        return `${getSnowflakeBaseUrl(params)}/api/v2/statements/${encodeURIComponent(params.statementHandle.trim())}?partition=${partition}`
      },
      method: 'GET',
      headers: getSnowflakeHeaders,
    },
    transformResponse: transformSnowflakeResult((params) => ({
      currentPartition: partitionNumber(params?.partition),
      partitionCount: partitionCountNumber(params?.partitionCount),
      fallbackStatementHandle: params?.statementHandle.trim(),
    })),
    outputs: SNOWFLAKE_STATEMENT_OUTPUTS,
  }
