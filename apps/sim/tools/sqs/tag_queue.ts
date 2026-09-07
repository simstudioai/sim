import type { SqsMessageResponse, SqsTagQueueParams } from '@/tools/sqs/types'
import type { InternalToolConfig } from '@/tools/types'

export const tagQueueTool: InternalToolConfig<SqsTagQueueParams, SqsMessageResponse> = {
  id: 'sqs_tag_queue',
  name: 'SQS Tag Queue',
  description: 'Add or overwrite cost-allocation tags on an Amazon SQS queue',
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
    tags: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Tags to apply as { "key": "value" } pairs. An existing key is overwritten. AWS recommends no more than 50 tags per queue',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      queueUrl: params.queueUrl,
      tags: params.tags,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to tag SQS queue')
    }

    return {
      success: true,
      output: {
        message: data.message || 'SQS queue tagged successfully',
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
  },
}
