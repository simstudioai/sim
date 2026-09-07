import type {
  SqsCancelMessageMoveTaskParams,
  SqsCancelMessageMoveTaskResponse,
} from '@/tools/sqs/types'
import type { InternalToolConfig } from '@/tools/types'

export const cancelMessageMoveTaskTool: InternalToolConfig<
  SqsCancelMessageMoveTaskParams,
  SqsCancelMessageMoveTaskResponse
> = {
  id: 'sqs_cancel_message_move_task',
  name: 'SQS Cancel Message Move Task',
  description: 'Cancel an in-progress Amazon SQS message move task',
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
    taskHandle: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Task handle returned by sqs_start_message_move_task or sqs_list_message_move_tasks. Only a RUNNING task can be cancelled',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      taskHandle: params.taskHandle,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to cancel SQS message move task')
    }

    return {
      success: true,
      output: {
        message: data.message || 'SQS message move task cancelled successfully',
        approximateNumberOfMessagesMoved: data.approximateNumberOfMessagesMoved ?? null,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    approximateNumberOfMessagesMoved: {
      type: 'number',
      description: 'Approximate number of messages already moved before the task was cancelled',
      optional: true,
      nullable: true,
    },
  },
}
