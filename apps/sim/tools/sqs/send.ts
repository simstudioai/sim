import type { SqsSendMessageParams, SqsSendMessageResponse } from '@/tools/sqs/types'
import type { ToolConfig } from '@/tools/types'

export const sendTool: ToolConfig<SqsSendMessageParams, SqsSendMessageResponse> = {
  id: 'sqs_send',
  name: 'SQS Send Message',
  description: 'Send a message to an Amazon SQS queue',
  version: '1.0',

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
      type: 'object',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Message body to send as JSON object (e.g., { "action": "process", "payload": {...} })',
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

  request: {
    url: '/api/tools/sqs/send',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      queueUrl: params.queueUrl,
      data: params.data,
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
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    id: { type: 'string', description: 'Message ID' },
  },
}
