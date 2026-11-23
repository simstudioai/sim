import type {
  AthenaGetQueryExecutionParams,
  AthenaGetQueryExecutionResponse,
} from '@/tools/athena/types'
import { AWS_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { InternalToolConfig } from '@/tools/types'

export const getQueryExecutionTool: InternalToolConfig<
  AthenaGetQueryExecutionParams,
  AthenaGetQueryExecutionResponse
> = {
  id: 'athena_get_query_execution',
  name: 'Athena Get Query Execution',
  description: 'Get the status and details of an Athena query execution',
  version: '1.0.0',
  oauth: AWS_CREDENTIAL_OAUTH,

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

  operation: {
    input: (params) => ({
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
        servicePreProcessingTimeInMillis: data.output.servicePreProcessingTimeInMillis ?? null,
        serviceProcessingTimeInMillis: data.output.serviceProcessingTimeInMillis ?? null,
        dataManifestLocation: data.output.dataManifestLocation ?? null,
        reusedPreviousResult: data.output.reusedPreviousResult ?? null,
        athenaError: data.output.athenaError ?? null,
        executionParameters: data.output.executionParameters ?? null,
        substatementType: data.output.substatementType ?? null,
        engineVersion: data.output.engineVersion ?? null,
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
    servicePreProcessingTimeInMillis: {
      type: 'number',
      description:
        'Time Athena spent preprocessing the query before submitting it, in milliseconds',
      optional: true,
    },
    serviceProcessingTimeInMillis: {
      type: 'number',
      description:
        'Time Athena spent finalizing and publishing results after execution, in milliseconds',
      optional: true,
    },
    dataManifestLocation: {
      type: 'string',
      description: 'S3 location of the manifest file listing files written by the query',
      optional: true,
    },
    reusedPreviousResult: {
      type: 'boolean',
      description: 'Whether the query reused a previous result instead of scanning data',
      optional: true,
    },
    athenaError: {
      type: 'json',
      description:
        'Failure details for a FAILED query (errorCategory: 1 system, 2 user, 3 other; errorType; retryable; errorMessage)',
      optional: true,
    },
    executionParameters: {
      type: 'array',
      description: "Values supplied for the query's ? placeholders",
      optional: true,
    },
    substatementType: {
      type: 'string',
      description: 'Kind of query statement that was run (e.g., SELECT, INSERT, CREATE_TABLE)',
      optional: true,
    },
    engineVersion: {
      type: 'json',
      description: 'Engine version used (selectedEngineVersion, effectiveEngineVersion)',
      optional: true,
    },
  },
}
