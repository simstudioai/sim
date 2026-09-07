import type {
  SqsStartMessageMoveTaskParams,
  SqsStartMessageMoveTaskResponse,
} from '@/tools/sqs/types'
import type { InternalToolConfig } from '@/tools/types'

export const startMessageMoveTaskTool: InternalToolConfig<
  SqsStartMessageMoveTaskParams,
  SqsStartMessageMoveTaskResponse
> = {
  id: 'sqs_start_message_move_task',
  name: 'SQS Start Message Move Task',
  description: 'Start redriving messages out of an Amazon SQS dead-letter queue',
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
    sourceArn: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'ARN of the dead-letter queue to move messages out of (e.g., arn:aws:sqs:us-east-1:123456789012:my-dlq)',
    },
    destinationArn: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ARN of the queue to move messages into. Omit to redrive each message to its original source queue',
    },
    maxNumberOfMessagesPerSecond: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Throttle the move to at most this many messages per second, up to 500. Omit to move as fast as possible',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      sourceArn: params.sourceArn,
      destinationArn: params.destinationArn,
      maxNumberOfMessagesPerSecond: params.maxNumberOfMessagesPerSecond,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to start SQS message move task')
    }

    return {
      success: true,
      output: {
        message: data.message || 'SQS message move task started successfully',
        taskHandle: data.taskHandle ?? null,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    taskHandle: {
      type: 'string',
      description: 'Handle identifying the move task, accepted by sqs_cancel_message_move_task',
      optional: true,
    },
  },
}
