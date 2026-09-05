import type { SqsListDeadLetterSourceQueuesParams, SqsQueueListResponse } from '@/tools/sqs/types'
import type { InternalToolConfig } from '@/tools/types'

export const listDeadLetterSourceQueuesTool: InternalToolConfig<
  SqsListDeadLetterSourceQueuesParams,
  SqsQueueListResponse
> = {
  id: 'sqs_list_dead_letter_source_queues',
  name: 'SQS List Dead-Letter Source Queues',
  description: 'List the Amazon SQS queues that use a given queue as their dead-letter queue',
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
    queueUrl: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'URL of the dead-letter queue whose source queues should be listed',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Maximum source queues to return, 1-1000. Must be set to receive a nextToken (default returns up to 1000)',
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
      queueUrl: params.queueUrl,
      maxResults: params.maxResults,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list SQS dead-letter source queues')
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
      description: 'URLs of the source queues that redrive to this dead-letter queue',
      items: { type: 'string', description: 'Queue URL' },
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of results',
      optional: true,
    },
    count: { type: 'number', description: 'Number of source queues returned' },
  },
}
