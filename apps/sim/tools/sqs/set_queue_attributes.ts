import type { SqsMessageResponse, SqsSetQueueAttributesParams } from '@/tools/sqs/types'
import type { InternalToolConfig } from '@/tools/types'

export const setQueueAttributesTool: InternalToolConfig<
  SqsSetQueueAttributesParams,
  SqsMessageResponse
> = {
  id: 'sqs_set_queue_attributes',
  name: 'SQS Set Queue Attributes',
  description: 'Update configuration attributes of an existing Amazon SQS queue',
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
    attributes: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Attributes to set as string values, e.g. { "VisibilityTimeout": "60", "MessageRetentionPeriod": "345600", "RedrivePolicy": "{...}" }. FifoQueue can only be set at creation',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      queueUrl: params.queueUrl,
      attributes: params.attributes,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to set SQS queue attributes')
    }

    return {
      success: true,
      output: {
        message: data.message || 'SQS queue attributes updated successfully',
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
  },
}
