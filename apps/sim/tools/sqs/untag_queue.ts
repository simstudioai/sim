import type { SqsMessageResponse, SqsUntagQueueParams } from '@/tools/sqs/types'
import type { InternalToolConfig } from '@/tools/types'

export const untagQueueTool: InternalToolConfig<SqsUntagQueueParams, SqsMessageResponse> = {
  id: 'sqs_untag_queue',
  name: 'SQS Untag Queue',
  description: 'Remove cost-allocation tags from an Amazon SQS queue',
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
    tagKeys: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      minItems: 1,
      items: { type: 'string' },
      description: 'Tag keys to remove, e.g. ["env", "team"]',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      queueUrl: params.queueUrl,
      tagKeys: params.tagKeys,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to untag SQS queue')
    }

    return {
      success: true,
      output: {
        message: data.message || 'SQS queue tags removed successfully',
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
  },
}
