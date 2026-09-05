/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateSqsClient, mockDestroy, mockSend } = vi.hoisted(() => ({
  mockCreateSqsClient: vi.fn(),
  mockDestroy: vi.fn(),
  mockSend: vi.fn(),
}))

vi.mock('@/lib/internal/sqs/client', () => ({
  createSqsClient: mockCreateSqsClient,
}))

import {
  executeSqsDeleteMessageBatch,
  executeSqsListDeadLetterSourceQueues,
  executeSqsReceiveMessage,
  executeSqsSend,
} from '@/lib/internal/sqs/operations'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

const QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue'

describe('SQS operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateSqsClient.mockReturnValue({ send: mockSend, destroy: mockDestroy })
  })

  it('sends a message, forwards cancellation, and destroys the AWS client', async () => {
    const controller = new AbortController()
    mockSend.mockResolvedValue({ MessageId: 'message-id', MD5OfMessageBody: 'digest' })

    await expect(
      executeSqsSend(
        { ...CONNECTION, queueUrl: QUEUE_URL, data: { action: 'process' } },
        controller.signal
      )
    ).resolves.toEqual({
      message: `Message sent to SQS queue ${QUEUE_URL}`,
      id: 'message-id',
      md5OfMessageBody: 'digest',
      md5OfMessageAttributes: null,
      sequenceNumber: null,
    })

    const [command, options] = mockSend.mock.calls[0]
    expect(command.input).toMatchObject({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify({ action: 'process' }),
    })
    expect(options).toEqual({ abortSignal: controller.signal })
    expect(mockDestroy).toHaveBeenCalledOnce()
  })

  it('maps message attributes onto the SQS wire shape', async () => {
    mockSend.mockResolvedValue({ MessageId: 'message-id' })

    await executeSqsSend({
      ...CONNECTION,
      queueUrl: QUEUE_URL,
      data: { action: 'process' },
      delaySeconds: 30,
      messageAttributes: { priority: { dataType: 'Number', stringValue: '1' } },
    })

    expect(mockSend.mock.calls[0][0].input).toMatchObject({
      DelaySeconds: 30,
      MessageAttributes: { priority: { DataType: 'Number', StringValue: '1' } },
    })
  })

  it('projects received messages and their attributes', async () => {
    mockSend.mockResolvedValue({
      Messages: [
        {
          MessageId: 'message-id',
          ReceiptHandle: 'receipt-handle',
          Body: '{"action":"process"}',
          MD5OfBody: 'digest',
          Attributes: { SenderId: 'sender', Unset: undefined },
          MessageAttributes: {
            priority: { DataType: 'Number', StringValue: '1' },
          },
        },
      ],
    })

    await expect(
      executeSqsReceiveMessage({ ...CONNECTION, queueUrl: QUEUE_URL, waitTimeSeconds: 20 })
    ).resolves.toEqual({
      count: 1,
      messages: [
        {
          messageId: 'message-id',
          receiptHandle: 'receipt-handle',
          body: '{"action":"process"}',
          md5OfBody: 'digest',
          md5OfMessageAttributes: null,
          attributes: { SenderId: 'sender' },
          messageAttributes: {
            priority: { dataType: 'Number', stringValue: '1', stringListValues: [] },
          },
        },
      ],
    })
  })

  it('reports partial batch failures rather than throwing', async () => {
    mockSend.mockResolvedValue({
      Successful: [{ Id: 'msg-1' }],
      Failed: [{ Id: 'msg-2', SenderFault: true, Code: 'ReceiptHandleIsInvalid' }],
    })

    await expect(
      executeSqsDeleteMessageBatch({
        ...CONNECTION,
        queueUrl: QUEUE_URL,
        entries: [
          { id: 'msg-1', receiptHandle: 'handle-1' },
          { id: 'msg-2', receiptHandle: 'handle-2' },
        ],
      })
    ).resolves.toMatchObject({
      successful: [{ id: 'msg-1' }],
      failed: [{ id: 'msg-2', senderFault: true, code: 'ReceiptHandleIsInvalid', message: null }],
      successCount: 1,
      failureCount: 1,
    })
  })

  it('reads the lowercase queueUrls field ListDeadLetterSourceQueues returns', async () => {
    mockSend.mockResolvedValue({ queueUrls: [QUEUE_URL], NextToken: 'next' })

    await expect(
      executeSqsListDeadLetterSourceQueues({ ...CONNECTION, queueUrl: QUEUE_URL })
    ).resolves.toEqual({ queueUrls: [QUEUE_URL], nextToken: 'next', count: 1 })
  })

  it('destroys the AWS client when provider execution fails', async () => {
    mockSend.mockRejectedValue(new Error('provider failure'))

    await expect(
      executeSqsSend({ ...CONNECTION, queueUrl: QUEUE_URL, data: { action: 'process' } })
    ).rejects.toThrow('provider failure')
    expect(mockDestroy).toHaveBeenCalledOnce()
  })
})
