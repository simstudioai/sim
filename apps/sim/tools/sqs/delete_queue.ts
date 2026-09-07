import type { SqsDeleteQueueParams, SqsMessageResponse } from '@/tools/sqs/types'
import type { InternalToolConfig } from '@/tools/types'

export const deleteQueueTool: InternalToolConfig<SqsDeleteQueueParams, SqsMessageResponse> = {
  id: 'sqs_delete_queue',
  name: 'SQS Delete Queue',
  description: 'Delete an Amazon SQS queue and every message still in it',
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
      throw new Error(data.error || 'Failed to delete SQS queue')
    }

    return {
      success: true,
      output: {
        message: data.message || 'SQS queue deleted successfully',
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
  },
}
