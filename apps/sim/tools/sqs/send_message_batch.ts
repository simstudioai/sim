import type { SqsSendMessageBatchParams, SqsSendMessageBatchResponse } from '@/tools/sqs/types'
import type { InternalToolConfig } from '@/tools/types'

export const sendMessageBatchTool: InternalToolConfig<
  SqsSendMessageBatchParams,
  SqsSendMessageBatchResponse
> = {
  id: 'sqs_send_message_batch',
  name: 'SQS Send Message Batch',
  description: 'Send up to 10 messages to an Amazon SQS queue in a single request',
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
        required: ['id', 'data'],
        properties: {
          id: { type: 'string' },
          data: { type: 'object' },
          delaySeconds: { type: 'number' },
          messageGroupId: { type: 'string' },
          messageDeduplicationId: { type: 'string' },
          messageAttributes: { type: 'object' },
        },
      },
      description:
        'Up to 10 entries, each { "id": "unique-id", "data": { ... }, "delaySeconds"?, "messageGroupId"?, "messageDeduplicationId"?, "messageAttributes"? }',
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
      throw new Error(data.error || 'Failed to send SQS message batch')
    }

    return {
      success: true,
      output: {
        message: data.message || 'SQS send message batch executed successfully',
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
      description: 'Entries that were accepted',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Id supplied for this batch entry' },
          messageId: { type: 'string', description: 'Message ID assigned by SQS' },
          md5OfMessageBody: { type: 'string', description: 'MD5 digest of the message body' },
          md5OfMessageAttributes: {
            type: 'string',
            description: 'MD5 digest of the message attributes',
            optional: true,
          },
          sequenceNumber: {
            type: 'string',
            description: 'Sequence number assigned by a FIFO queue',
            optional: true,
          },
        },
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
    successCount: { type: 'number', description: 'Number of messages accepted' },
    failureCount: { type: 'number', description: 'Number of messages rejected' },
  },
}
