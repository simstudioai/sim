import type { AthenaStopQueryParams, AthenaStopQueryResponse } from '@/tools/athena/types'
import type { ToolConfig } from '@/tools/types'

export const stopQueryTool: ToolConfig<AthenaStopQueryParams, AthenaStopQueryResponse> = {
  id: 'athena_stop_query',
  name: 'Athena Stop Query',
  description: 'Stop a running Athena query execution',
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
      description: 'Query execution ID to stop',
    },
  },

  request: {
    url: '/api/tools/athena/stop-query',
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
      throw new Error(data.error || 'Failed to stop Athena query')
    }
    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the query was successfully stopped',
    },
  },
}
