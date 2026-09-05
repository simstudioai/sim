import type { SqsGetQueueAttributesParams, SqsQueueAttributesResponse } from '@/tools/sqs/types'
import type { InternalToolConfig } from '@/tools/types'

export const getQueueAttributesTool: InternalToolConfig<
  SqsGetQueueAttributesParams,
  SqsQueueAttributesResponse
> = {
  id: 'sqs_get_queue_attributes',
  name: 'SQS Get Queue Attributes',
  description: 'Read configuration and message-count attributes of an Amazon SQS queue',
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
    attributeNames: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      items: { type: 'string' },
      description:
        'Attributes to return, e.g. ["All"], ["ApproximateNumberOfMessages"], ["QueueArn"], ["VisibilityTimeout"], ["RedrivePolicy"]. Omitting this returns no attributes',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      queueUrl: params.queueUrl,
      attributeNames: params.attributeNames,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get SQS queue attributes')
    }

    return {
      success: true,
      output: {
        attributes: data.attributes ?? {},
      },
      error: undefined,
    }
  },

  outputs: {
    attributes: {
      type: 'json',
      description:
        'Queue attributes as string values keyed by attribute name (e.g., ApproximateNumberOfMessages, QueueArn, VisibilityTimeout, RedrivePolicy)',
    },
  },
}
