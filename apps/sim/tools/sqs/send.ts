import type { SqsSendMessageParams, SqsSendMessageResponse } from '@/tools/sqs/types'
import type { InternalToolConfig } from '@/tools/types'

export const sendTool: InternalToolConfig<SqsSendMessageParams, SqsSendMessageResponse> = {
  id: 'sqs_send',
  name: 'SQS Send Message',
  description: 'Send a message to an Amazon SQS queue',
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
    data: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Message body to send as JSON object (e.g., { "action": "process", "payload": {...} })',
    },
    delaySeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Seconds to delay delivery of this message, 0-900. Not supported per-message on FIFO queues',
    },
    messageAttributes: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Message attributes keyed by name, each { "dataType": "String" | "Number", "stringValue": "..." }. A custom label such as Number.float is allowed; Binary attributes are not supported',
    },
    messageGroupId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Message group ID for FIFO queues (e.g., "order-processing-group")',
    },
    messageDeduplicationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Message deduplication ID for FIFO queues (e.g., "order-12345-v1")',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      queueUrl: params.queueUrl,
      data: params.data,
      delaySeconds: params.delaySeconds,
      messageAttributes: params.messageAttributes,
      messageGroupId: params.messageGroupId,
      messageDeduplicationId: params.messageDeduplicationId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'SQS send message failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'SQS send message executed successfully',
        id: data.id || '',
        md5OfMessageBody: data.md5OfMessageBody ?? null,
        md5OfMessageAttributes: data.md5OfMessageAttributes ?? null,
        sequenceNumber: data.sequenceNumber ?? null,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    id: { type: 'string', description: 'Message ID' },
    md5OfMessageBody: {
      type: 'string',
      description: 'MD5 digest of the message body, for verifying SQS received it intact',
      optional: true,
    },
    md5OfMessageAttributes: {
      type: 'string',
      description: 'MD5 digest of the message attributes',
      optional: true,
    },
    sequenceNumber: {
      type: 'string',
      description: 'Large, non-consecutive sequence number assigned by a FIFO queue',
      optional: true,
    },
  },
}
