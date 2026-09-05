import type { SqsCreateQueueParams, SqsCreateQueueResponse } from '@/tools/sqs/types'
import type { InternalToolConfig } from '@/tools/types'

export const createQueueTool: InternalToolConfig<SqsCreateQueueParams, SqsCreateQueueResponse> = {
  id: 'sqs_create_queue',
  name: 'SQS Create Queue',
  description: 'Create a standard or FIFO Amazon SQS queue',
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
        'Queue name, up to 80 characters of letters, digits, hyphens and underscores. A FIFO queue name must end in .fifo',
    },
    attributes: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Queue attributes as string values, e.g. { "FifoQueue": "true", "VisibilityTimeout": "30", "DelaySeconds": "0", "RedrivePolicy": "{...}" }',
    },
    tags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cost-allocation tags to apply to the new queue, as { "key": "value" } pairs',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      queueName: params.queueName,
      attributes: params.attributes,
      tags: params.tags,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create SQS queue')
    }

    return {
      success: true,
      output: {
        message: data.message || 'SQS queue created successfully',
        queueUrl: data.queueUrl ?? null,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    queueUrl: {
      type: 'string',
      description: 'URL of the created queue',
      optional: true,
    },
  },
}
