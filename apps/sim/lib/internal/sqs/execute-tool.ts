import { getErrorMessage } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import { awsSqsCancelMessageMoveTaskContract } from '@/lib/api/contracts/tools/aws/sqs-cancel-message-move-task'
import { awsSqsChangeMessageVisibilityContract } from '@/lib/api/contracts/tools/aws/sqs-change-message-visibility'
import { awsSqsChangeMessageVisibilityBatchContract } from '@/lib/api/contracts/tools/aws/sqs-change-message-visibility-batch'
import { awsSqsCreateQueueContract } from '@/lib/api/contracts/tools/aws/sqs-create-queue'
import { awsSqsDeleteMessageContract } from '@/lib/api/contracts/tools/aws/sqs-delete-message'
import { awsSqsDeleteMessageBatchContract } from '@/lib/api/contracts/tools/aws/sqs-delete-message-batch'
import { awsSqsDeleteQueueContract } from '@/lib/api/contracts/tools/aws/sqs-delete-queue'
import { awsSqsGetQueueAttributesContract } from '@/lib/api/contracts/tools/aws/sqs-get-queue-attributes'
import { awsSqsGetQueueUrlContract } from '@/lib/api/contracts/tools/aws/sqs-get-queue-url'
import { awsSqsListDeadLetterSourceQueuesContract } from '@/lib/api/contracts/tools/aws/sqs-list-dead-letter-source-queues'
import { awsSqsListMessageMoveTasksContract } from '@/lib/api/contracts/tools/aws/sqs-list-message-move-tasks'
import { awsSqsListQueueTagsContract } from '@/lib/api/contracts/tools/aws/sqs-list-queue-tags'
import { awsSqsListQueuesContract } from '@/lib/api/contracts/tools/aws/sqs-list-queues'
import { awsSqsPurgeQueueContract } from '@/lib/api/contracts/tools/aws/sqs-purge-queue'
import { awsSqsReceiveMessageContract } from '@/lib/api/contracts/tools/aws/sqs-receive-message'
import { awsSqsSendMessageContract } from '@/lib/api/contracts/tools/aws/sqs-send-message'
import { awsSqsSendMessageBatchContract } from '@/lib/api/contracts/tools/aws/sqs-send-message-batch'
import { awsSqsSetQueueAttributesContract } from '@/lib/api/contracts/tools/aws/sqs-set-queue-attributes'
import { awsSqsStartMessageMoveTaskContract } from '@/lib/api/contracts/tools/aws/sqs-start-message-move-task'
import { awsSqsTagQueueContract } from '@/lib/api/contracts/tools/aws/sqs-tag-queue'
import { awsSqsUntagQueueContract } from '@/lib/api/contracts/tools/aws/sqs-untag-queue'
import {
  executeSqsCancelMessageMoveTask,
  executeSqsChangeMessageVisibility,
  executeSqsChangeMessageVisibilityBatch,
  executeSqsCreateQueue,
  executeSqsDeleteMessage,
  executeSqsDeleteMessageBatch,
  executeSqsDeleteQueue,
  executeSqsGetQueueAttributes,
  executeSqsGetQueueUrl,
  executeSqsListDeadLetterSourceQueues,
  executeSqsListMessageMoveTasks,
  executeSqsListQueues,
  executeSqsListQueueTags,
  executeSqsPurgeQueue,
  executeSqsReceiveMessage,
  executeSqsSend,
  executeSqsSendMessageBatch,
  executeSqsSetQueueAttributes,
  executeSqsStartMessageMoveTask,
  executeSqsTagQueue,
  executeSqsUntagQueue,
} from '@/lib/internal/sqs/operations'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown,
  execute: (input: ContractBody<C>, signal?: AbortSignal) => Promise<unknown>,
  errorMessage: string,
  signal?: AbortSignal
): Promise<Response> {
  signal?.throwIfAborted()
  const parsed = parseInternalToolInput(contract, input)
  if (!parsed.success) return parsed.response

  try {
    const result = await execute(parsed.data, signal)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    return Response.json(
      { error: `${errorMessage}: ${getErrorMessage(error, 'Unknown error occurred')}` },
      { status: 500 }
    )
  }
}

export const executeSqsTool: InternalToolOperationHandler = async ({ toolId, input, signal }) => {
  signal?.throwIfAborted()

  switch (toolId) {
    case 'sqs_send':
      return executeOperation(
        awsSqsSendMessageContract,
        input,
        executeSqsSend,
        'SQS send message failed',
        signal
      )
    case 'sqs_send_message_batch':
      return executeOperation(
        awsSqsSendMessageBatchContract,
        input,
        executeSqsSendMessageBatch,
        'Failed to send SQS message batch',
        signal
      )
    case 'sqs_receive_message':
      return executeOperation(
        awsSqsReceiveMessageContract,
        input,
        executeSqsReceiveMessage,
        'Failed to receive SQS messages',
        signal
      )
    case 'sqs_delete_message':
      return executeOperation(
        awsSqsDeleteMessageContract,
        input,
        executeSqsDeleteMessage,
        'Failed to delete SQS message',
        signal
      )
    case 'sqs_delete_message_batch':
      return executeOperation(
        awsSqsDeleteMessageBatchContract,
        input,
        executeSqsDeleteMessageBatch,
        'Failed to delete SQS message batch',
        signal
      )
    case 'sqs_change_message_visibility':
      return executeOperation(
        awsSqsChangeMessageVisibilityContract,
        input,
        executeSqsChangeMessageVisibility,
        'Failed to change SQS message visibility',
        signal
      )
    case 'sqs_change_message_visibility_batch':
      return executeOperation(
        awsSqsChangeMessageVisibilityBatchContract,
        input,
        executeSqsChangeMessageVisibilityBatch,
        'Failed to change SQS message visibility batch',
        signal
      )
    case 'sqs_list_queues':
      return executeOperation(
        awsSqsListQueuesContract,
        input,
        executeSqsListQueues,
        'Failed to list SQS queues',
        signal
      )
    case 'sqs_get_queue_url':
      return executeOperation(
        awsSqsGetQueueUrlContract,
        input,
        executeSqsGetQueueUrl,
        'Failed to get SQS queue URL',
        signal
      )
    case 'sqs_get_queue_attributes':
      return executeOperation(
        awsSqsGetQueueAttributesContract,
        input,
        executeSqsGetQueueAttributes,
        'Failed to get SQS queue attributes',
        signal
      )
    case 'sqs_set_queue_attributes':
      return executeOperation(
        awsSqsSetQueueAttributesContract,
        input,
        executeSqsSetQueueAttributes,
        'Failed to set SQS queue attributes',
        signal
      )
    case 'sqs_create_queue':
      return executeOperation(
        awsSqsCreateQueueContract,
        input,
        executeSqsCreateQueue,
        'Failed to create SQS queue',
        signal
      )
    case 'sqs_delete_queue':
      return executeOperation(
        awsSqsDeleteQueueContract,
        input,
        executeSqsDeleteQueue,
        'Failed to delete SQS queue',
        signal
      )
    case 'sqs_purge_queue':
      return executeOperation(
        awsSqsPurgeQueueContract,
        input,
        executeSqsPurgeQueue,
        'Failed to purge SQS queue',
        signal
      )
    case 'sqs_list_dead_letter_source_queues':
      return executeOperation(
        awsSqsListDeadLetterSourceQueuesContract,
        input,
        executeSqsListDeadLetterSourceQueues,
        'Failed to list SQS dead-letter source queues',
        signal
      )
    case 'sqs_list_queue_tags':
      return executeOperation(
        awsSqsListQueueTagsContract,
        input,
        executeSqsListQueueTags,
        'Failed to list SQS queue tags',
        signal
      )
    case 'sqs_tag_queue':
      return executeOperation(
        awsSqsTagQueueContract,
        input,
        executeSqsTagQueue,
        'Failed to tag SQS queue',
        signal
      )
    case 'sqs_untag_queue':
      return executeOperation(
        awsSqsUntagQueueContract,
        input,
        executeSqsUntagQueue,
        'Failed to untag SQS queue',
        signal
      )
    case 'sqs_start_message_move_task':
      return executeOperation(
        awsSqsStartMessageMoveTaskContract,
        input,
        executeSqsStartMessageMoveTask,
        'Failed to start SQS message move task',
        signal
      )
    case 'sqs_list_message_move_tasks':
      return executeOperation(
        awsSqsListMessageMoveTasksContract,
        input,
        executeSqsListMessageMoveTasks,
        'Failed to list SQS message move tasks',
        signal
      )
    case 'sqs_cancel_message_move_task':
      return executeOperation(
        awsSqsCancelMessageMoveTaskContract,
        input,
        executeSqsCancelMessageMoveTask,
        'Failed to cancel SQS message move task',
        signal
      )
    default:
      return Response.json({ error: `Unsupported SQS tool: ${toolId}` }, { status: 500 })
  }
}
