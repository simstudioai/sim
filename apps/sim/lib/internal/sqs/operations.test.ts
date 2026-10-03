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
} from '@/lib/internal/sqs/operations'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

const QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue'

describe('SQS operations', () => {
  beforeEach(() => {
    mockCreateSqsClient.mockReturnValue({ send: mockSend, destroy: mockDestroy })
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
})
