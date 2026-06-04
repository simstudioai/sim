import type {
  AthenaGetQueryExecutionParams,
  AthenaGetQueryExecutionResponse,
} from '@/tools/athena/types'
import type { ToolConfig } from '@/tools/types'

export const getQueryExecutionTool: ToolConfig<
  AthenaGetQueryExecutionParams,
  AthenaGetQueryExecutionResponse
> = {
  id: 'athena_get_query_execution',
  name: 'Athena Get Query Execution',
  description: 'Get the status and details of an Athena query execution',
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
    queryExecutionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Query execution ID to check',
    },
  },

  request: {
    url: '/api/tools/athena/get-query-execution',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      queryExecutionId: params.queryExecutionId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to get Athena query execution')
    }
    return {
      success: true,
      output: {
        queryExecutionId: data.output.queryExecutionId,
        query: data.output.query,
        state: data.output.state,
        stateChangeReason: data.output.stateChangeReason ?? null,
        statementType: data.output.statementType ?? null,
        database: data.output.database ?? null,
        catalog: data.output.catalog ?? null,
        workGroup: data.output.workGroup ?? null,
        submissionDateTime: data.output.submissionDateTime ?? null,
        completionDateTime: data.output.completionDateTime ?? null,
        dataScannedInBytes: data.output.dataScannedInBytes ?? null,
        engineExecutionTimeInMillis: data.output.engineExecutionTimeInMillis ?? null,
        queryPlanningTimeInMillis: data.output.queryPlanningTimeInMillis ?? null,
        queryQueueTimeInMillis: data.output.queryQueueTimeInMillis ?? null,
        totalExecutionTimeInMillis: data.output.totalExecutionTimeInMillis ?? null,
        outputLocation: data.output.outputLocation ?? null,
      },
    }
  },

  outputs: {
    queryExecutionId: { type: 'string', description: 'Query execution ID' },
    query: { type: 'string', description: 'SQL query string' },
    state: {
      type: 'string',
      description: 'Query state (QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED)',
    },
    stateChangeReason: {
      type: 'string',
      description: 'Reason for state change (e.g., error message)',
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
}
