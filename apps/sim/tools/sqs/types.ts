import type { ToolResponse } from '@/tools/types'

export interface SqsConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

/** A message attribute in the JSON-safe form Sim tools accept. */
export interface SqsMessageAttributeInput {
  dataType: string
  stringValue: string
}

/** A message attribute as projected from a received message. */
export interface SqsMessageAttributeOutput {
  dataType: string | null
  stringValue: string | null
  stringListValues: string[]
}

/** One entry of the `Failed` list every SQS batch action returns. */
export interface SqsBatchErrorEntry {
  id: string | null
  senderFault: boolean | null
  code: string | null
  message: string | null
}

export interface SqsSendMessageParams extends SqsConnectionConfig {
  queueUrl: string
  data: Record<string, unknown>
  delaySeconds?: number | null
  messageAttributes?: Record<string, SqsMessageAttributeInput> | null
  messageGroupId?: string | null
  messageDeduplicationId?: string | null
}

export interface SqsSendMessageBatchEntry {
  id: string
  data: Record<string, unknown>
  delaySeconds?: number | null
  messageAttributes?: Record<string, SqsMessageAttributeInput> | null
  messageGroupId?: string | null
  messageDeduplicationId?: string | null
}

export interface SqsSendMessageBatchParams extends SqsConnectionConfig {
  queueUrl: string
  entries: SqsSendMessageBatchEntry[]
}

export interface SqsReceiveMessageParams extends SqsConnectionConfig {
  queueUrl: string
  maxNumberOfMessages?: number | null
  visibilityTimeout?: number | null
  waitTimeSeconds?: number | null
  messageAttributeNames?: string[] | null
  messageSystemAttributeNames?: string[] | null
  receiveRequestAttemptId?: string | null
}

export interface SqsDeleteMessageParams extends SqsConnectionConfig {
  queueUrl: string
  receiptHandle: string
}

export interface SqsDeleteMessageBatchParams extends SqsConnectionConfig {
  queueUrl: string
  entries: { id: string; receiptHandle: string }[]
}

export interface SqsChangeMessageVisibilityParams extends SqsConnectionConfig {
  queueUrl: string
  receiptHandle: string
  visibilityTimeout: number
}

export interface SqsChangeMessageVisibilityBatchParams extends SqsConnectionConfig {
  queueUrl: string
  entries: { id: string; receiptHandle: string; visibilityTimeout?: number | null }[]
}

export interface SqsListQueuesParams extends SqsConnectionConfig {
  queueNamePrefix?: string | null
  maxResults?: number | null
  nextToken?: string | null
}

export interface SqsGetQueueUrlParams extends SqsConnectionConfig {
  queueName: string
  queueOwnerAwsAccountId?: string | null
}

export interface SqsGetQueueAttributesParams extends SqsConnectionConfig {
  queueUrl: string
  attributeNames?: string[] | null
}

export interface SqsSetQueueAttributesParams extends SqsConnectionConfig {
  queueUrl: string
  attributes: Record<string, string>
}

export interface SqsCreateQueueParams extends SqsConnectionConfig {
  queueName: string
  attributes?: Record<string, string> | null
  tags?: Record<string, string> | null
}

export interface SqsDeleteQueueParams extends SqsConnectionConfig {
  queueUrl: string
}

export interface SqsPurgeQueueParams extends SqsConnectionConfig {
  queueUrl: string
}

export interface SqsListDeadLetterSourceQueuesParams extends SqsConnectionConfig {
  queueUrl: string
  maxResults?: number | null
  nextToken?: string | null
}

export interface SqsListQueueTagsParams extends SqsConnectionConfig {
  queueUrl: string
}

export interface SqsTagQueueParams extends SqsConnectionConfig {
  queueUrl: string
  tags: Record<string, string>
}

export interface SqsUntagQueueParams extends SqsConnectionConfig {
  queueUrl: string
  tagKeys: string[]
}

export interface SqsStartMessageMoveTaskParams extends SqsConnectionConfig {
  sourceArn: string
  destinationArn?: string | null
  maxNumberOfMessagesPerSecond?: number | null
}

export interface SqsListMessageMoveTasksParams extends SqsConnectionConfig {
  sourceArn: string
  maxResults?: number | null
}

export interface SqsCancelMessageMoveTaskParams extends SqsConnectionConfig {
  taskHandle: string
}

interface SqsBaseResponse extends ToolResponse {
  output: { message: string; id?: string }
  error?: string
}

export interface SqsSendMessageResponse extends ToolResponse {
  output: {
    message: string
    id: string
    md5OfMessageBody: string | null
    md5OfMessageAttributes: string | null
    sequenceNumber: string | null
  }
  error?: string
}

export interface SqsSendMessageBatchResponse extends ToolResponse {
  output: {
    message: string
    successful: {
      id: string | null
      messageId: string | null
      md5OfMessageBody: string | null
      md5OfMessageAttributes: string | null
      sequenceNumber: string | null
    }[]
    failed: SqsBatchErrorEntry[]
    successCount: number
    failureCount: number
  }
  error?: string
}

export interface SqsReceiveMessageResponse extends ToolResponse {
  output: {
    messages: {
      messageId: string | null
      receiptHandle: string | null
      body: string | null
      md5OfBody: string | null
      md5OfMessageAttributes: string | null
      attributes: Record<string, string>
      messageAttributes: Record<string, SqsMessageAttributeOutput>
    }[]
    count: number
  }
  error?: string
}

export interface SqsMessageResponse extends ToolResponse {
  output: { message: string }
  error?: string
}

export interface SqsBatchResultResponse extends ToolResponse {
  output: {
    message: string
    successful: { id: string | null }[]
    failed: SqsBatchErrorEntry[]
    successCount: number
    failureCount: number
  }
  error?: string
}

export interface SqsQueueListResponse extends ToolResponse {
  output: {
    queueUrls: string[]
    nextToken: string | null
    count: number
  }
  error?: string
}

export interface SqsGetQueueUrlResponse extends ToolResponse {
  output: { queueUrl: string | null }
  error?: string
}

export interface SqsQueueAttributesResponse extends ToolResponse {
  output: { attributes: Record<string, string> }
  error?: string
}

export interface SqsCreateQueueResponse extends ToolResponse {
  output: { message: string; queueUrl: string | null }
  error?: string
}

export interface SqsQueueTagsResponse extends ToolResponse {
  output: { tags: Record<string, string> }
  error?: string
}

export interface SqsStartMessageMoveTaskResponse extends ToolResponse {
  output: { message: string; taskHandle: string | null }
  error?: string
}

export interface SqsListMessageMoveTasksResponse extends ToolResponse {
  output: {
    results: {
      taskHandle: string | null
      status: string | null
      sourceArn: string | null
      destinationArn: string | null
      maxNumberOfMessagesPerSecond: number | null
      approximateNumberOfMessagesMoved: number | null
      approximateNumberOfMessagesToMove: number | null
      failureReason: string | null
      startedTimestamp: number | null
    }[]
    count: number
  }
  error?: string
}

export interface SqsCancelMessageMoveTaskResponse extends ToolResponse {
  output: { message: string; approximateNumberOfMessagesMoved: number | null }
  error?: string
}

export interface SqsResponse extends SqsBaseResponse {}
