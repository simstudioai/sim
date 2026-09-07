import type { SqsChangeMessageVisibilityParams, SqsMessageResponse } from '@/tools/sqs/types'
import type { InternalToolConfig } from '@/tools/types'

export const changeMessageVisibilityTool: InternalToolConfig<
  SqsChangeMessageVisibilityParams,
  SqsMessageResponse
> = {
  id: 'sqs_change_message_visibility',
  name: 'SQS Change Message Visibility',
  description: 'Change how long a received Amazon SQS message stays hidden from other consumers',
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
      description: 'Receipt handle returned by sqs_receive_message for the message to update',
    },
    visibilityTimeout: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'New visibility timeout in seconds, 0-43200 (12 hours). 0 makes the message immediately visible again',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      queueUrl: params.queueUrl,
      receiptHandle: params.receiptHandle,
      visibilityTimeout: params.visibilityTimeout,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to change SQS message visibility')
    }

    return {
      success: true,
      output: {
        message: data.message || 'SQS message visibility changed successfully',
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
  },
}
