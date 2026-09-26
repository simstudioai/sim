/**
 * Boundary guards the SQS contracts owe their callers, each standing in for an
 * AWS error the request would otherwise earn at the provider:
 * `BatchEntryIdsNotDistinct` for a reused batch entry id, `InvalidAttributeName`
 * for a read-only or create-only queue attribute, and the documented ten-attribute
 * cap on message attributes. Each case is rejected locally so the caller sees the
 * failing field instead of losing the whole request.
 */
import { describe, expect, it } from 'vitest'
import { awsSqsChangeMessageVisibilityBatchContract } from '@/lib/api/contracts/tools/aws/sqs-change-message-visibility-batch'
import { awsSqsCreateQueueContract } from '@/lib/api/contracts/tools/aws/sqs-create-queue'
import { awsSqsDeleteMessageBatchContract } from '@/lib/api/contracts/tools/aws/sqs-delete-message-batch'
import { awsSqsSendMessageContract } from '@/lib/api/contracts/tools/aws/sqs-send-message'
import { awsSqsSendMessageBatchContract } from '@/lib/api/contracts/tools/aws/sqs-send-message-batch'
import { awsSqsSetQueueAttributesContract } from '@/lib/api/contracts/tools/aws/sqs-set-queue-attributes'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'secret',
}

const QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue'

describe('SQS batch entry id uniqueness', () => {
  it('rejects a send batch that reuses an entry id', () => {
    const result = awsSqsSendMessageBatchContract.body.safeParse({
      ...CONNECTION,
      queueUrl: QUEUE_URL,
      entries: [
        { id: 'msg-1', data: { order: 1 } },
        { id: 'msg-1', data: { order: 2 } },
      ],
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('Batch entry ids must be unique within a request')
  })

  it('rejects a delete batch that reuses an entry id', () => {
    const result = awsSqsDeleteMessageBatchContract.body.safeParse({
      ...CONNECTION,
      queueUrl: QUEUE_URL,
      entries: [
        { id: 'msg-1', receiptHandle: 'handle-1' },
        { id: 'msg-1', receiptHandle: 'handle-2' },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('rejects a visibility batch that reuses an entry id', () => {
    const result = awsSqsChangeMessageVisibilityBatchContract.body.safeParse({
      ...CONNECTION,
      queueUrl: QUEUE_URL,
      entries: [
        { id: 'msg-1', receiptHandle: 'handle-1', visibilityTimeout: 60 },
        { id: 'msg-1', receiptHandle: 'handle-2', visibilityTimeout: 90 },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('accepts a batch whose entry ids are distinct', () => {
    const result = awsSqsSendMessageBatchContract.body.safeParse({
      ...CONNECTION,
      queueUrl: QUEUE_URL,
      entries: [
        { id: 'msg-1', data: { order: 1 } },
        { id: 'msg-2', data: { order: 2 } },
      ],
    })

    expect(result.success).toBe(true)
  })
})

describe('SQS message attribute cap', () => {
  const attribute = { dataType: 'String', stringValue: 'value' }

  function attributes(count: number) {
    return Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`attr_${index}`, attribute])
    )
  }

  it('accepts the documented maximum of ten message attributes', () => {
    const result = awsSqsSendMessageContract.body.safeParse({
      ...CONNECTION,
      queueUrl: QUEUE_URL,
      data: { action: 'process' },
      messageAttributes: attributes(10),
    })

    expect(result.success).toBe(true)
  })

  it('rejects an eleventh message attribute', () => {
    const result = awsSqsSendMessageContract.body.safeParse({
      ...CONNECTION,
      queueUrl: QUEUE_URL,
      data: { action: 'process' },
      messageAttributes: attributes(11),
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(
      'A message can have at most 10 message attributes'
    )
  })
})

describe('SQS FIFO token fields', () => {
  it('rejects an empty messageGroupId rather than forwarding it to SQS', () => {
    const result = awsSqsSendMessageContract.body.safeParse({
      ...CONNECTION,
      queueUrl: QUEUE_URL,
      data: { action: 'process' },
      messageGroupId: '',
    })

    expect(result.success).toBe(false)
  })

  it('rejects an empty messageDeduplicationId', () => {
    const result = awsSqsSendMessageContract.body.safeParse({
      ...CONNECTION,
      queueUrl: QUEUE_URL,
      data: { action: 'process' },
      messageDeduplicationId: '',
    })

    expect(result.success).toBe(false)
  })

  it('still accepts an omitted messageGroupId', () => {
    const result = awsSqsSendMessageContract.body.safeParse({
      ...CONNECTION,
      queueUrl: QUEUE_URL,
      data: { action: 'process' },
    })

    expect(result.success).toBe(true)
  })
})

describe('SQS writable queue attributes', () => {
  it('accepts FifoQueue on CreateQueue, which is where AWS allows it', () => {
    const result = awsSqsCreateQueueContract.body.safeParse({
      ...CONNECTION,
      queueName: 'orders.fifo',
      attributes: { FifoQueue: 'true' },
    })

    expect(result.success).toBe(true)
  })

  it('rejects create-only FifoQueue on SetQueueAttributes', () => {
    const result = awsSqsSetQueueAttributesContract.body.safeParse({
      ...CONNECTION,
      queueUrl: QUEUE_URL,
      attributes: { FifoQueue: 'true' },
    })

    expect(result.success).toBe(false)
  })

  it.each(['ApproximateNumberOfMessages', 'CreatedTimestamp', 'LastModifiedTimestamp', 'QueueArn'])(
    'rejects the read-only attribute %s on SetQueueAttributes',
    (attributeName) => {
      const result = awsSqsSetQueueAttributesContract.body.safeParse({
        ...CONNECTION,
        queueUrl: QUEUE_URL,
        attributes: { [attributeName]: '1' },
      })

      expect(result.success).toBe(false)
    }
  )

  it.each(['ApproximateNumberOfMessages', 'QueueArn'])(
    'rejects the read-only attribute %s on CreateQueue',
    (attributeName) => {
      const result = awsSqsCreateQueueContract.body.safeParse({
        ...CONNECTION,
        queueName: 'orders',
        attributes: { [attributeName]: '1' },
      })

      expect(result.success).toBe(false)
    }
  )

  it('still accepts the attributes AWS documents as settable', () => {
    const result = awsSqsSetQueueAttributesContract.body.safeParse({
      ...CONNECTION,
      queueUrl: QUEUE_URL,
      attributes: { VisibilityTimeout: '60', DelaySeconds: '5', RedrivePolicy: '{}' },
    })

    expect(result.success).toBe(true)
  })
})
