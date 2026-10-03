import type { SqsListQueuesParams, SqsQueueListResponse } from '@/tools/sqs/types'
import type { InternalToolConfig } from '@/tools/types'

export const listQueuesTool: InternalToolConfig<SqsListQueuesParams, SqsQueueListResponse> = {
  id: 'sqs_list_queues',
  name: 'SQS List Queues',
  description: 'List Amazon SQS queue URLs in a region, optionally filtered by name prefix',
  version: '1.0.0',

  params: {
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    accessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    queueNamePrefix: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only queues whose name begins with this string (case-sensitive)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Maximum queues to return, 1-1000. Must be set to receive a nextToken (default returns up to 1000)',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous request',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      queueNamePrefix: params.queueNamePrefix,
      maxResults: params.maxResults,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list SQS queues')
    }

    return {
      success: true,
      output: {
        queueUrls: data.queueUrls ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
      error: undefined,
    }
  },

  outputs: {
    queueUrls: {
      type: 'array',
      description: 'Queue URLs returned by the request',
      items: { type: 'string', description: 'Queue URL' },
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of results',
      optional: true,
    },
    count: { type: 'number', description: 'Number of queue URLs returned' },
  },
}
