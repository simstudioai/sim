import {
  CancelMessageMoveTaskCommand,
  ChangeMessageVisibilityBatchCommand,
  ChangeMessageVisibilityCommand,
  CreateQueueCommand,
  DeleteMessageBatchCommand,
  DeleteMessageCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  ListDeadLetterSourceQueuesCommand,
  ListMessageMoveTasksCommand,
  ListQueuesCommand,
  ListQueueTagsCommand,
  type MessageAttributeValue,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SendMessageBatchCommand,
  SendMessageCommand,
  SetQueueAttributesCommand,
  type SQSClient,
  StartMessageMoveTaskCommand,
  TagQueueCommand,
  UntagQueueCommand,
} from '@aws-sdk/client-sqs'
import type { AwsSqsCancelMessageMoveTaskBody } from '@/lib/api/contracts/tools/aws/sqs-cancel-message-move-task'
import type { AwsSqsChangeMessageVisibilityBody } from '@/lib/api/contracts/tools/aws/sqs-change-message-visibility'
import type { AwsSqsChangeMessageVisibilityBatchBody } from '@/lib/api/contracts/tools/aws/sqs-change-message-visibility-batch'
import type { AwsSqsCreateQueueBody } from '@/lib/api/contracts/tools/aws/sqs-create-queue'
import type { AwsSqsDeleteMessageBody } from '@/lib/api/contracts/tools/aws/sqs-delete-message'
import type { AwsSqsDeleteMessageBatchBody } from '@/lib/api/contracts/tools/aws/sqs-delete-message-batch'
import type { AwsSqsDeleteQueueBody } from '@/lib/api/contracts/tools/aws/sqs-delete-queue'
import type { AwsSqsGetQueueAttributesBody } from '@/lib/api/contracts/tools/aws/sqs-get-queue-attributes'
import type { AwsSqsGetQueueUrlBody } from '@/lib/api/contracts/tools/aws/sqs-get-queue-url'
import type { AwsSqsListDeadLetterSourceQueuesBody } from '@/lib/api/contracts/tools/aws/sqs-list-dead-letter-source-queues'
import type { AwsSqsListMessageMoveTasksBody } from '@/lib/api/contracts/tools/aws/sqs-list-message-move-tasks'
import type { AwsSqsListQueueTagsBody } from '@/lib/api/contracts/tools/aws/sqs-list-queue-tags'
import type { AwsSqsListQueuesBody } from '@/lib/api/contracts/tools/aws/sqs-list-queues'
import type { AwsSqsPurgeQueueBody } from '@/lib/api/contracts/tools/aws/sqs-purge-queue'
import type { AwsSqsReceiveMessageBody } from '@/lib/api/contracts/tools/aws/sqs-receive-message'
import type { AwsSqsSendMessageBody } from '@/lib/api/contracts/tools/aws/sqs-send-message'
import type { AwsSqsSendMessageBatchBody } from '@/lib/api/contracts/tools/aws/sqs-send-message-batch'
import type { AwsSqsSetQueueAttributesBody } from '@/lib/api/contracts/tools/aws/sqs-set-queue-attributes'
import type { AwsSqsStartMessageMoveTaskBody } from '@/lib/api/contracts/tools/aws/sqs-start-message-move-task'
import type { AwsSqsTagQueueBody } from '@/lib/api/contracts/tools/aws/sqs-tag-queue'
import type { AwsSqsUntagQueueBody } from '@/lib/api/contracts/tools/aws/sqs-untag-queue'
import { createSqsClient } from '@/lib/internal/sqs/client'
import type { SqsConnectionConfig } from '@/tools/sqs/types'

async function withSqsClient<T>(
  config: SqsConnectionConfig,
  execute: (client: SQSClient) => Promise<T>
): Promise<T> {
  const client = createSqsClient(config)
  try {
    return await execute(client)
  } finally {
    client.destroy()
  }
}

/** Map Sim's JSON-safe message attribute input onto the SQS `MessageAttributeValue` shape. */
function toMessageAttributes(
  attributes: Record<string, { dataType: string; stringValue: string }> | null | undefined
): Record<string, MessageAttributeValue> | undefined {
  if (!attributes) return undefined
  const entries = Object.entries(attributes)
  if (entries.length === 0) return undefined
  const mapped: Record<string, MessageAttributeValue> = {}
  for (const [name, value] of entries) {
    mapped[name] = { DataType: value.dataType, StringValue: value.stringValue }
  }
  return mapped
}

/** Project received `MessageAttributeValue` entries into their JSON-safe string forms. */
function fromMessageAttributes(attributes: Record<string, MessageAttributeValue> | undefined) {
  const projected: Record<
    string,
    { dataType: string | null; stringValue: string | null; stringListValues: string[] }
  > = {}
  for (const [name, value] of Object.entries(attributes ?? {})) {
    projected[name] = {
      dataType: value.DataType ?? null,
      stringValue: value.StringValue ?? null,
      stringListValues: value.StringListValues ?? [],
    }
  }
  return projected
}

/** Drop the undefined values an SQS attribute map may carry so the result is JSON-stable. */
function toStringMap(map: Record<string, string | undefined> | undefined): Record<string, string> {
  const projected: Record<string, string> = {}
  for (const [key, value] of Object.entries(map ?? {})) {
    if (value !== undefined) projected[key] = value
  }
  return projected
}

/** Project the `BatchResultErrorEntry` list shared by all three SQS batch actions. */
function projectBatchFailures(
  failed: { Id?: string; SenderFault?: boolean; Code?: string; Message?: string }[] | undefined
) {
  return (failed ?? []).map((entry) => ({
    id: entry.Id ?? null,
    senderFault: entry.SenderFault ?? null,
    code: entry.Code ?? null,
    message: entry.Message ?? null,
  }))
}

export async function executeSqsSend(input: AwsSqsSendMessageBody, signal?: AbortSignal) {
  return withSqsClient(input, async (client) => {
    const response = await client.send(
      new SendMessageCommand({
        QueueUrl: input.queueUrl,
        MessageBody: JSON.stringify(input.data),
        DelaySeconds: input.delaySeconds ?? undefined,
        MessageAttributes: toMessageAttributes(input.messageAttributes),
        MessageGroupId: input.messageGroupId ?? undefined,
        MessageDeduplicationId: input.messageDeduplicationId ?? undefined,
      }),
      { abortSignal: signal }
    )
    return {
      message: `Message sent to SQS queue ${input.queueUrl}`,
      id: response.MessageId ?? null,
      md5OfMessageBody: response.MD5OfMessageBody ?? null,
      md5OfMessageAttributes: response.MD5OfMessageAttributes ?? null,
      sequenceNumber: response.SequenceNumber ?? null,
    }
  })
}

export async function executeSqsSendMessageBatch(
  input: AwsSqsSendMessageBatchBody,
  signal?: AbortSignal
) {
  return withSqsClient(input, async (client) => {
    const response = await client.send(
      new SendMessageBatchCommand({
        QueueUrl: input.queueUrl,
        Entries: input.entries.map((entry) => ({
          Id: entry.id,
          MessageBody: JSON.stringify(entry.data),
          DelaySeconds: entry.delaySeconds ?? undefined,
          MessageAttributes: toMessageAttributes(entry.messageAttributes),
          MessageGroupId: entry.messageGroupId ?? undefined,
          MessageDeduplicationId: entry.messageDeduplicationId ?? undefined,
        })),
      }),
      { abortSignal: signal }
    )
    const successful = (response.Successful ?? []).map((entry) => ({
      id: entry.Id ?? null,
      messageId: entry.MessageId ?? null,
      md5OfMessageBody: entry.MD5OfMessageBody ?? null,
      md5OfMessageAttributes: entry.MD5OfMessageAttributes ?? null,
      sequenceNumber: entry.SequenceNumber ?? null,
    }))
    const failed = projectBatchFailures(response.Failed)
    return {
      message: `Sent ${successful.length} of ${input.entries.length} messages to SQS queue ${input.queueUrl}`,
      successful,
      failed,
      successCount: successful.length,
      failureCount: failed.length,
    }
  })
}

export async function executeSqsReceiveMessage(
  input: AwsSqsReceiveMessageBody,
  signal?: AbortSignal
) {
  return withSqsClient(input, async (client) => {
    const response = await client.send(
      new ReceiveMessageCommand({
        QueueUrl: input.queueUrl,
        MaxNumberOfMessages: input.maxNumberOfMessages ?? undefined,
        VisibilityTimeout: input.visibilityTimeout ?? undefined,
        WaitTimeSeconds: input.waitTimeSeconds ?? undefined,
        MessageAttributeNames: input.messageAttributeNames ?? undefined,
        MessageSystemAttributeNames: input.messageSystemAttributeNames ?? undefined,
        ReceiveRequestAttemptId: input.receiveRequestAttemptId ?? undefined,
      }),
      { abortSignal: signal }
    )
    const messages = (response.Messages ?? []).map((message) => ({
      messageId: message.MessageId ?? null,
      receiptHandle: message.ReceiptHandle ?? null,
      body: message.Body ?? null,
      md5OfBody: message.MD5OfBody ?? null,
      md5OfMessageAttributes: message.MD5OfMessageAttributes ?? null,
      attributes: toStringMap(message.Attributes),
      messageAttributes: fromMessageAttributes(message.MessageAttributes),
    }))
    return { messages, count: messages.length }
  })
}

export async function executeSqsDeleteMessage(
  input: AwsSqsDeleteMessageBody,
  signal?: AbortSignal
) {
  return withSqsClient(input, async (client) => {
    await client.send(
      new DeleteMessageCommand({
        QueueUrl: input.queueUrl,
        ReceiptHandle: input.receiptHandle,
      }),
      { abortSignal: signal }
    )
    return { message: `Message deleted from SQS queue ${input.queueUrl}` }
  })
}

export async function executeSqsDeleteMessageBatch(
  input: AwsSqsDeleteMessageBatchBody,
  signal?: AbortSignal
) {
  return withSqsClient(input, async (client) => {
    const response = await client.send(
      new DeleteMessageBatchCommand({
        QueueUrl: input.queueUrl,
        Entries: input.entries.map((entry) => ({
          Id: entry.id,
          ReceiptHandle: entry.receiptHandle,
        })),
      }),
      { abortSignal: signal }
    )
    const successful = (response.Successful ?? []).map((entry) => ({ id: entry.Id ?? null }))
    const failed = projectBatchFailures(response.Failed)
    return {
      message: `Deleted ${successful.length} of ${input.entries.length} messages from SQS queue ${input.queueUrl}`,
      successful,
      failed,
      successCount: successful.length,
      failureCount: failed.length,
    }
  })
}

export async function executeSqsChangeMessageVisibility(
  input: AwsSqsChangeMessageVisibilityBody,
  signal?: AbortSignal
) {
  return withSqsClient(input, async (client) => {
    await client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: input.queueUrl,
        ReceiptHandle: input.receiptHandle,
        VisibilityTimeout: input.visibilityTimeout,
      }),
      { abortSignal: signal }
    )
    return {
      message: `Visibility timeout set to ${input.visibilityTimeout} seconds on SQS queue ${input.queueUrl}`,
    }
  })
}

export async function executeSqsChangeMessageVisibilityBatch(
  input: AwsSqsChangeMessageVisibilityBatchBody,
  signal?: AbortSignal
) {
  return withSqsClient(input, async (client) => {
    const response = await client.send(
      new ChangeMessageVisibilityBatchCommand({
        QueueUrl: input.queueUrl,
        Entries: input.entries.map((entry) => ({
          Id: entry.id,
          ReceiptHandle: entry.receiptHandle,
          VisibilityTimeout: entry.visibilityTimeout ?? undefined,
        })),
      }),
      { abortSignal: signal }
    )
    const successful = (response.Successful ?? []).map((entry) => ({ id: entry.Id ?? null }))
    const failed = projectBatchFailures(response.Failed)
    return {
      message: `Changed visibility for ${successful.length} of ${input.entries.length} messages on SQS queue ${input.queueUrl}`,
      successful,
      failed,
      successCount: successful.length,
      failureCount: failed.length,
    }
  })
}

export async function executeSqsListQueues(input: AwsSqsListQueuesBody, signal?: AbortSignal) {
  return withSqsClient(input, async (client) => {
    const response = await client.send(
      new ListQueuesCommand({
        QueueNamePrefix: input.queueNamePrefix ?? undefined,
        MaxResults: input.maxResults ?? undefined,
        NextToken: input.nextToken ?? undefined,
      }),
      { abortSignal: signal }
    )
    const queueUrls = response.QueueUrls ?? []
    return { queueUrls, nextToken: response.NextToken ?? null, count: queueUrls.length }
  })
}

export async function executeSqsGetQueueUrl(input: AwsSqsGetQueueUrlBody, signal?: AbortSignal) {
  return withSqsClient(input, async (client) => {
    const response = await client.send(
      new GetQueueUrlCommand({
        QueueName: input.queueName,
        QueueOwnerAWSAccountId: input.queueOwnerAwsAccountId ?? undefined,
      }),
      { abortSignal: signal }
    )
    return { queueUrl: response.QueueUrl ?? null }
  })
}

export async function executeSqsGetQueueAttributes(
  input: AwsSqsGetQueueAttributesBody,
  signal?: AbortSignal
) {
  return withSqsClient(input, async (client) => {
    const response = await client.send(
      new GetQueueAttributesCommand({
        QueueUrl: input.queueUrl,
        AttributeNames: input.attributeNames ?? undefined,
      }),
      { abortSignal: signal }
    )
    return { attributes: toStringMap(response.Attributes) }
  })
}

export async function executeSqsSetQueueAttributes(
  input: AwsSqsSetQueueAttributesBody,
  signal?: AbortSignal
) {
  return withSqsClient(input, async (client) => {
    await client.send(
      new SetQueueAttributesCommand({
        QueueUrl: input.queueUrl,
        Attributes: input.attributes,
      }),
      { abortSignal: signal }
    )
    return { message: `Attributes updated on SQS queue ${input.queueUrl}` }
  })
}

export async function executeSqsCreateQueue(input: AwsSqsCreateQueueBody, signal?: AbortSignal) {
  return withSqsClient(input, async (client) => {
    const response = await client.send(
      new CreateQueueCommand({
        QueueName: input.queueName,
        Attributes: input.attributes ?? undefined,
        tags: input.tags ?? undefined,
      }),
      { abortSignal: signal }
    )
    return {
      message: `SQS queue "${input.queueName}" created`,
      queueUrl: response.QueueUrl ?? null,
    }
  })
}

export async function executeSqsDeleteQueue(input: AwsSqsDeleteQueueBody, signal?: AbortSignal) {
  return withSqsClient(input, async (client) => {
    await client.send(new DeleteQueueCommand({ QueueUrl: input.queueUrl }), {
      abortSignal: signal,
    })
    return { message: `SQS queue ${input.queueUrl} deleted` }
  })
}

export async function executeSqsPurgeQueue(input: AwsSqsPurgeQueueBody, signal?: AbortSignal) {
  return withSqsClient(input, async (client) => {
    await client.send(new PurgeQueueCommand({ QueueUrl: input.queueUrl }), { abortSignal: signal })
    return { message: `SQS queue ${input.queueUrl} purged` }
  })
}

export async function executeSqsListDeadLetterSourceQueues(
  input: AwsSqsListDeadLetterSourceQueuesBody,
  signal?: AbortSignal
) {
  return withSqsClient(input, async (client) => {
    const response = await client.send(
      new ListDeadLetterSourceQueuesCommand({
        QueueUrl: input.queueUrl,
        MaxResults: input.maxResults ?? undefined,
        NextToken: input.nextToken ?? undefined,
      }),
      { abortSignal: signal }
    )
    const queueUrls = response.queueUrls ?? []
    return { queueUrls, nextToken: response.NextToken ?? null, count: queueUrls.length }
  })
}

export async function executeSqsListQueueTags(
  input: AwsSqsListQueueTagsBody,
  signal?: AbortSignal
) {
  return withSqsClient(input, async (client) => {
    const response = await client.send(new ListQueueTagsCommand({ QueueUrl: input.queueUrl }), {
      abortSignal: signal,
    })
    return { tags: toStringMap(response.Tags) }
  })
}

export async function executeSqsTagQueue(input: AwsSqsTagQueueBody, signal?: AbortSignal) {
  return withSqsClient(input, async (client) => {
    await client.send(new TagQueueCommand({ QueueUrl: input.queueUrl, Tags: input.tags }), {
      abortSignal: signal,
    })
    return { message: `Tags applied to SQS queue ${input.queueUrl}` }
  })
}

export async function executeSqsUntagQueue(input: AwsSqsUntagQueueBody, signal?: AbortSignal) {
  return withSqsClient(input, async (client) => {
    await client.send(new UntagQueueCommand({ QueueUrl: input.queueUrl, TagKeys: input.tagKeys }), {
      abortSignal: signal,
    })
    return { message: `Tags removed from SQS queue ${input.queueUrl}` }
  })
}

export async function executeSqsStartMessageMoveTask(
  input: AwsSqsStartMessageMoveTaskBody,
  signal?: AbortSignal
) {
  return withSqsClient(input, async (client) => {
    const response = await client.send(
      new StartMessageMoveTaskCommand({
        SourceArn: input.sourceArn,
        DestinationArn: input.destinationArn ?? undefined,
        MaxNumberOfMessagesPerSecond: input.maxNumberOfMessagesPerSecond ?? undefined,
      }),
      { abortSignal: signal }
    )
    return {
      message: `Message move task started for ${input.sourceArn}`,
      taskHandle: response.TaskHandle ?? null,
    }
  })
}

export async function executeSqsListMessageMoveTasks(
  input: AwsSqsListMessageMoveTasksBody,
  signal?: AbortSignal
) {
  return withSqsClient(input, async (client) => {
    const response = await client.send(
      new ListMessageMoveTasksCommand({
        SourceArn: input.sourceArn,
        MaxResults: input.maxResults ?? undefined,
      }),
      { abortSignal: signal }
    )
    const results = (response.Results ?? []).map((task) => ({
      taskHandle: task.TaskHandle ?? null,
      status: task.Status ?? null,
      sourceArn: task.SourceArn ?? null,
      destinationArn: task.DestinationArn ?? null,
      maxNumberOfMessagesPerSecond: task.MaxNumberOfMessagesPerSecond ?? null,
      approximateNumberOfMessagesMoved: task.ApproximateNumberOfMessagesMoved ?? null,
      approximateNumberOfMessagesToMove: task.ApproximateNumberOfMessagesToMove ?? null,
      failureReason: task.FailureReason ?? null,
      startedTimestamp: task.StartedTimestamp ?? null,
    }))
    return { results, count: results.length }
  })
}

export async function executeSqsCancelMessageMoveTask(
  input: AwsSqsCancelMessageMoveTaskBody,
  signal?: AbortSignal
) {
  return withSqsClient(input, async (client) => {
    const response = await client.send(
      new CancelMessageMoveTaskCommand({ TaskHandle: input.taskHandle }),
      { abortSignal: signal }
    )
    return {
      message: 'Message move task cancelled',
      approximateNumberOfMessagesMoved: response.ApproximateNumberOfMessagesMoved ?? null,
    }
  })
}
