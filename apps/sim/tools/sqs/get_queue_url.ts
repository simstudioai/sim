import type { SqsGetQueueUrlParams, SqsGetQueueUrlResponse } from '@/tools/sqs/types'
import type { InternalToolConfig } from '@/tools/types'

export const getQueueUrlTool: InternalToolConfig<SqsGetQueueUrlParams, SqsGetQueueUrlResponse> = {
  id: 'sqs_get_queue_url',
  name: 'SQS Get Queue URL',
  description: 'Resolve an Amazon SQS queue name to its queue URL',
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
    queueName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Queue name, up to 80 characters of letters, digits, hyphens and underscores. A FIFO queue name ends in .fifo',
    },
    queueOwnerAwsAccountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        '12-digit AWS account ID of the queue owner, when the queue belongs to another account',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      queueName: params.queueName,
      queueOwnerAwsAccountId: params.queueOwnerAwsAccountId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get SQS queue URL')
    }

    return {
      success: true,
      output: {
        queueUrl: data.queueUrl ?? null,
      },
      error: undefined,
    }
  },

  outputs: {
    queueUrl: {
      type: 'string',
      description: 'URL of the queue',
      optional: true,
    },
  },
}
