import type {
  SqsListMessageMoveTasksParams,
  SqsListMessageMoveTasksResponse,
} from '@/tools/sqs/types'
import type { InternalToolConfig } from '@/tools/types'

export const listMessageMoveTasksTool: InternalToolConfig<
  SqsListMessageMoveTasksParams,
  SqsListMessageMoveTasksResponse
> = {
  id: 'sqs_list_message_move_tasks',
  name: 'SQS List Message Move Tasks',
  description: 'List the most recent message move tasks for an Amazon SQS source queue',
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
        'ARN of the queue whose move tasks should be listed (e.g., arn:aws:sqs:us-east-1:123456789012:my-dlq)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum move tasks to return, 1-10 (default 1)',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      sourceArn: params.sourceArn,
      maxResults: params.maxResults,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list SQS message move tasks')
    }

    return {
      success: true,
      output: {
        results: data.results ?? [],
        count: data.count ?? 0,
      },
      error: undefined,
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Move tasks for the source queue',
      items: {
        type: 'object',
        properties: {
          taskHandle: {
            type: 'string',
            description: 'Handle of the task, populated only while its status is RUNNING',
            optional: true,
          },
          status: {
            type: 'string',
            description: 'RUNNING, COMPLETED, CANCELLING, CANCELLED, or FAILED',
          },
          sourceArn: { type: 'string', description: 'ARN of the source queue' },
          destinationArn: {
            type: 'string',
            description: 'ARN of the destination queue, absent when redriving to source queues',
            optional: true,
          },
          maxNumberOfMessagesPerSecond: {
            type: 'number',
            description: 'Per-second throttle applied to the move',
            optional: true,
          },
          approximateNumberOfMessagesMoved: {
            type: 'number',
            description: 'Approximate number of messages moved so far',
          },
          approximateNumberOfMessagesToMove: {
            type: 'number',
            description: 'Approximate number of messages still to move',
            optional: true,
          },
          failureReason: {
            type: 'string',
            description: 'Why the task failed, set only when the status is FAILED',
            optional: true,
          },
          startedTimestamp: {
            type: 'number',
            description: 'Epoch milliseconds when the task started',
          },
        },
      },
    },
    count: { type: 'number', description: 'Number of move tasks returned' },
  },
}
