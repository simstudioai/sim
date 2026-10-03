import type { SqsBatchResultResponse, SqsDeleteMessageBatchParams } from '@/tools/sqs/types'
import type { InternalToolConfig } from '@/tools/types'

export const deleteMessageBatchTool: InternalToolConfig<
  SqsDeleteMessageBatchParams,
  SqsBatchResultResponse
> = {
  id: 'sqs_delete_message_batch',
  name: 'SQS Delete Message Batch',
  description: 'Delete up to 10 received messages from an Amazon SQS queue in a single request',
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
        required: ['id', 'receiptHandle'],
        properties: {
          id: { type: 'string' },
          receiptHandle: { type: 'string' },
        },
      },
      description:
        'Up to 10 entries, each { "id": "unique-id", "receiptHandle": "..." }. Receipt handles come from sqs_receive_message',
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
      throw new Error(data.error || 'Failed to delete SQS message batch')
    }

    return {
      success: true,
      output: {
        message: data.message || 'SQS delete message batch executed successfully',
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
      description: 'Entries that were deleted',
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
    successCount: { type: 'number', description: 'Number of messages deleted' },
    failureCount: { type: 'number', description: 'Number of messages rejected' },
  },
}
