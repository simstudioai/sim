import type {
  AthenaBatchGetQueryExecutionParams,
  AthenaBatchGetQueryExecutionResponse,
} from '@/tools/athena/types'
import type { ToolConfig } from '@/tools/types'

export const batchGetQueryExecutionTool: ToolConfig<
  AthenaBatchGetQueryExecutionParams,
  AthenaBatchGetQueryExecutionResponse
> = {
  id: 'athena_batch_get_query_execution',
  name: 'Athena Batch Get Query Executions',
  description: 'Get the status and details of up to 50 Athena query executions in one call',
  version: '1.0.0',

  params: {
    awsRegion: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    awsAccessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    awsSecretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    queryExecutionIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated query execution IDs to check (up to 50)',
    },
  },

  request: {
    url: '/api/tools/athena/batch-get-query-execution',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const ids = params.queryExecutionIds
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
      return {
        region: params.awsRegion,
        accessKeyId: params.awsAccessKeyId,
        secretAccessKey: params.awsSecretAccessKey,
        queryExecutionIds: ids,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to batch get Athena query executions')
    }
    return {
      success: true,
      output: {
        queryExecutions: data.output.queryExecutions ?? [],
        unprocessedQueryExecutionIds: data.output.unprocessedQueryExecutionIds ?? [],
      },
    }
  },

  outputs: {
    queryExecutions: {
      type: 'array',
      description: 'Details for each successfully retrieved query execution',
      items: {
        type: 'object',
        properties: {
          queryExecutionId: { type: 'string', description: 'Query execution ID' },
          query: { type: 'string', description: 'SQL query string', optional: true },
          state: {
            type: 'string',
            description: 'Query state (QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED)',
            optional: true,
          },
          stateChangeReason: {
            type: 'string',
            description: 'Reason for state change',
            optional: true,
          },
          statementType: {
            type: 'string',
            description: 'Statement type (DDL, DML, UTILITY)',
            optional: true,
          },
          database: { type: 'string', description: 'Database name', optional: true },
          catalog: { type: 'string', description: 'Data catalog name', optional: true },
          workGroup: { type: 'string', description: 'Workgroup name', optional: true },
          submissionDateTime: {
            type: 'number',
            description: 'Query submission time (Unix epoch ms)',
            optional: true,
          },
          completionDateTime: {
            type: 'number',
            description: 'Query completion time (Unix epoch ms)',
            optional: true,
          },
          dataScannedInBytes: {
            type: 'number',
            description: 'Amount of data scanned in bytes',
            optional: true,
          },
          engineExecutionTimeInMillis: {
            type: 'number',
            description: 'Engine execution time in milliseconds',
            optional: true,
          },
          queryPlanningTimeInMillis: {
            type: 'number',
            description: 'Query planning time in milliseconds',
            optional: true,
          },
          queryQueueTimeInMillis: {
            type: 'number',
            description: 'Time the query spent in queue in milliseconds',
            optional: true,
          },
          totalExecutionTimeInMillis: {
            type: 'number',
            description: 'Total execution time in milliseconds',
            optional: true,
          },
          outputLocation: {
            type: 'string',
            description: 'S3 location of query results',
            optional: true,
          },
        },
      },
    },
    unprocessedQueryExecutionIds: {
      type: 'array',
      description: 'Query execution IDs that could not be retrieved, with error details',
      items: {
        type: 'object',
        properties: {
          queryExecutionId: { type: 'string', description: 'Query execution ID', optional: true },
          errorCode: { type: 'string', description: 'Error code', optional: true },
          errorMessage: { type: 'string', description: 'Error message', optional: true },
        },
      },
    },
  },
}
