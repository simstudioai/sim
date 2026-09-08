import type {
  AthenaGetQueryRuntimeStatisticsParams,
  AthenaGetQueryRuntimeStatisticsResponse,
} from '@/tools/athena/types'
import type { InternalToolConfig } from '@/tools/types'

export const getQueryRuntimeStatisticsTool: InternalToolConfig<
  AthenaGetQueryRuntimeStatisticsParams,
  AthenaGetQueryRuntimeStatisticsResponse
> = {
  id: 'athena_get_query_runtime_statistics',
  name: 'Athena Get Query Runtime Statistics',
  description:
    'Get runtime statistics (timeline, row counts, and output stage) for a completed Athena query execution',
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
      description: 'Query execution ID to get runtime statistics for',
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
      throw new Error(data.error || 'Failed to get Athena query runtime statistics')
    }
    return {
      success: true,
      output: {
        queryExecutionId: data.output.queryExecutionId,
        timeline: data.output.timeline,
        rowStatistics: data.output.rowStatistics,
        outputStage: data.output.outputStage ?? null,
      },
    }
  },

  outputs: {
    queryExecutionId: {
      type: 'string',
      description: 'Query execution ID',
    },
    timeline: {
      type: 'json',
      description:
        'Timing breakdown in milliseconds (available once the query has SUCCEEDED or FAILED)',
      properties: {
        queryQueueTimeInMillis: {
          type: 'number',
          description: 'Time spent in queue',
          optional: true,
        },
        servicePreProcessingTimeInMillis: {
          type: 'number',
          description: 'Service pre-processing time',
          optional: true,
        },
        queryPlanningTimeInMillis: {
          type: 'number',
          description: 'Query planning time',
          optional: true,
        },
        engineExecutionTimeInMillis: {
          type: 'number',
          description: 'Engine execution time',
          optional: true,
        },
        serviceProcessingTimeInMillis: {
          type: 'number',
          description: 'Service processing time',
          optional: true,
        },
        totalExecutionTimeInMillis: {
          type: 'number',
          description: 'Total execution time',
          optional: true,
        },
      },
    },
    rowStatistics: {
      type: 'json',
      description:
        'Row and byte counts (updated asynchronously; may be null shortly after completion)',
      properties: {
        inputRows: { type: 'number', description: 'Rows read', optional: true },
        inputBytes: { type: 'number', description: 'Bytes read', optional: true },
        outputRows: { type: 'number', description: 'Rows produced', optional: true },
        outputBytes: { type: 'number', description: 'Bytes produced', optional: true },
      },
    },
    outputStage: {
      type: 'json',
      description: 'Summary of the final query stage',
      optional: true,
      properties: {
        stageId: { type: 'number', description: 'Stage identifier', optional: true },
        state: { type: 'string', description: 'Stage state', optional: true },
        inputRows: { type: 'number', description: 'Rows read by the stage', optional: true },
        inputBytes: { type: 'number', description: 'Bytes read by the stage', optional: true },
        outputRows: { type: 'number', description: 'Rows produced by the stage', optional: true },
        outputBytes: { type: 'number', description: 'Bytes produced by the stage', optional: true },
        executionTime: {
          type: 'number',
          description: 'Stage execution time in milliseconds',
          optional: true,
        },
        subStageCount: { type: 'number', description: 'Number of direct sub-stages' },
      },
    },
  },
}
