import type {
  CloudWatchQueryLogsParams,
  CloudWatchQueryLogsResponse,
} from '@/tools/cloudwatch/types'
import type { ToolConfig } from '@/tools/types'

export const queryLogsTool: ToolConfig<CloudWatchQueryLogsParams, CloudWatchQueryLogsResponse> = {
  id: 'cloudwatch_query_logs',
  name: 'CloudWatch Query Logs',
  description: 'Run a CloudWatch Log Insights query against one or more log groups',
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
    logGroupNames: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Log group names to query',
    },
    queryString: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'CloudWatch Log Insights query string',
    },
    startTime: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start time as Unix epoch seconds',
    },
    endTime: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'End time as Unix epoch seconds',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return',
    },
  },

  request: {
    url: '/api/tools/cloudwatch/query-logs',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      logGroupNames: params.logGroupNames,
      queryString: params.queryString,
      startTime: params.startTime,
      endTime: params.endTime,
      ...(params.limit !== undefined && { limit: params.limit }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'CloudWatch Log Insights query failed')
    }

    return {
      success: true,
      output: {
        results: data.output.results,
        statistics: data.output.statistics,
        status: data.output.status,
      },
    }
  },

  outputs: {
    results: { type: 'array', description: 'Query result rows' },
    statistics: {
      type: 'object',
      description: 'Query statistics (bytesScanned, recordsMatched, recordsScanned)',
    },
    status: { type: 'string', description: 'Query completion status' },
  },
}
