import type { SqsListQueueTagsParams, SqsQueueTagsResponse } from '@/tools/sqs/types'
import type { InternalToolConfig } from '@/tools/types'

export const listQueueTagsTool: InternalToolConfig<SqsListQueueTagsParams, SqsQueueTagsResponse> = {
  id: 'sqs_list_queue_tags',
  name: 'SQS List Queue Tags',
  description: 'List the cost-allocation tags attached to an Amazon SQS queue',
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
      description:
        'SQS queue URL (e.g., https://sqs.us-east-1.amazonaws.com/123456789012/my-queue)',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      queueUrl: params.queueUrl,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list SQS queue tags')
    }

    return {
      success: true,
      output: {
        tags: data.tags ?? {},
      },
      error: undefined,
    }
  },

  outputs: {
    tags: {
      type: 'json',
      description: 'Tags attached to the queue, as string values keyed by tag key',
    },
  },
}
