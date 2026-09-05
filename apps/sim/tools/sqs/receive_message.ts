import type { SqsReceiveMessageParams, SqsReceiveMessageResponse } from '@/tools/sqs/types'
import type { InternalToolConfig } from '@/tools/types'

export const receiveMessageTool: InternalToolConfig<
  SqsReceiveMessageParams,
  SqsReceiveMessageResponse
> = {
  id: 'sqs_receive_message',
  name: 'SQS Receive Message',
  description: 'Receive up to 10 messages from an Amazon SQS queue, with optional long polling',
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
    maxNumberOfMessages: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of messages to return, 1-10 (default 1)',
    },
    waitTimeSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Long-poll duration in seconds, 0-20. Waits for a message to arrive before returning (default 0, short poll)',
    },
    visibilityTimeout: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Seconds the returned messages stay hidden from other consumers, 0-43200. Defaults to the queue setting',
    },
    messageAttributeNames: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      items: { type: 'string' },
      description:
        'Names of user-defined message attributes to return. Use ["All"] to return all of them',
    },
    messageSystemAttributeNames: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      items: { type: 'string' },
      description:
        'System attributes to return: All, SenderId, SentTimestamp, ApproximateReceiveCount, ApproximateFirstReceiveTimestamp, SequenceNumber, MessageDeduplicationId, MessageGroupId, AWSTraceHeader, DeadLetterQueueSourceArn',
    },
    receiveRequestAttemptId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'FIFO queues only: deduplication token that lets a retried receive return the same messages (max 128 characters)',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      queueUrl: params.queueUrl,
      maxNumberOfMessages: params.maxNumberOfMessages,
      waitTimeSeconds: params.waitTimeSeconds,
      visibilityTimeout: params.visibilityTimeout,
      messageAttributeNames: params.messageAttributeNames,
      messageSystemAttributeNames: params.messageSystemAttributeNames,
      receiveRequestAttemptId: params.receiveRequestAttemptId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to receive SQS messages')
    }

    return {
      success: true,
      output: {
        messages: data.messages ?? [],
        count: data.count ?? 0,
      },
      error: undefined,
    }
  },

  outputs: {
    messages: {
      type: 'array',
      description:
        'Received messages. Pass a receiptHandle to sqs_delete_message, sqs_delete_message_batch, sqs_change_message_visibility, or sqs_change_message_visibility_batch',
      items: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'Unique ID SQS assigned to the message' },
          receiptHandle: {
            type: 'string',
            description: 'Handle identifying this receipt of the message, required to delete it',
          },
          body: { type: 'string', description: 'Message body as it was sent' },
          md5OfBody: { type: 'string', description: 'MD5 digest of the message body' },
          md5OfMessageAttributes: {
            type: 'string',
            description: 'MD5 digest of the message attributes',
            optional: true,
          },
          attributes: {
            type: 'json',
            description: 'Requested system attributes as string values keyed by attribute name',
          },
          messageAttributes: {
            type: 'json',
            description:
              'Requested user-defined attributes, each with dataType, stringValue, and stringListValues',
          },
        },
      },
    },
    count: { type: 'number', description: 'Number of messages returned' },
  },
}
