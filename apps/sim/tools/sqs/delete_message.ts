import type { SqsDeleteMessageParams, SqsMessageResponse } from '@/tools/sqs/types'
import type { InternalToolConfig } from '@/tools/types'

export const deleteMessageTool: InternalToolConfig<SqsDeleteMessageParams, SqsMessageResponse> = {
  id: 'sqs_delete_message',
  name: 'SQS Delete Message',
  description: 'Delete a received message from an Amazon SQS queue using its receipt handle',
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
    receiptHandle: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Receipt handle returned by sqs_receive_message for the message to delete',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      queueUrl: params.queueUrl,
      receiptHandle: params.receiptHandle,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete SQS message')
    }

    return {
      success: true,
      output: {
        message: data.message || 'SQS message deleted successfully',
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
  },
}
