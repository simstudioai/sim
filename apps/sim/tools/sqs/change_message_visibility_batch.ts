import type {
  SqsBatchResultResponse,
  SqsChangeMessageVisibilityBatchParams,
} from '@/tools/sqs/types'
import type { InternalToolConfig } from '@/tools/types'

export const changeMessageVisibilityBatchTool: InternalToolConfig<
  SqsChangeMessageVisibilityBatchParams,
  SqsBatchResultResponse
> = {
  id: 'sqs_change_message_visibility_batch',
  name: 'SQS Change Message Visibility Batch',
  description: 'Change the visibility timeout of up to 10 received Amazon SQS messages at once',
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
    entries: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          receiptHandle: { type: 'string' },
          visibilityTimeout: { type: 'number', minimum: 0, maximum: 43200 },
        },
      },
      description:
        'Up to 10 entries, each { "id": "unique-id", "receiptHandle": "...", "visibilityTimeout": 0-43200 }. Receipt handles come from sqs_receive_message',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      queueUrl: params.queueUrl,
      entries: params.entries,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to change SQS message visibility batch')
    }

    return {
      success: true,
      output: {
        message: data.message || 'SQS change message visibility batch executed successfully',
        successful: data.successful ?? [],
        failed: data.failed ?? [],
        successCount: data.successCount ?? 0,
        failureCount: data.failureCount ?? 0,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    successful: {
      type: 'array',
      description: 'Entries that were updated',
      items: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Id supplied for this batch entry' } },
      },
    },
    failed: {
      type: 'array',
      description: 'Entries that were rejected',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Id supplied for this batch entry' },
          senderFault: { type: 'boolean', description: 'Whether the sender caused the failure' },
          code: { type: 'string', description: 'Error code for the failure' },
          message: {
            type: 'string',
            description: 'Human-readable failure message',
            optional: true,
          },
        },
      },
    },
    successCount: { type: 'number', description: 'Number of messages updated' },
    failureCount: { type: 'number', description: 'Number of messages rejected' },
  },
}
