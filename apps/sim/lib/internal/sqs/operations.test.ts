import { envFlagsMock } from '@sim/testing/mocks/env-flags.mock'
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
    envFlagsMock.isHosted = true
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

  it.each([
    'https://attacker.example/123456789012/test-queue',
    'https://ec2-1-2-3-4.compute-1.amazonaws.com/123456789012/test-queue',
    'https://abc123.execute-api.us-east-1.amazonaws.com/123456789012/test-queue',
    'http://sqs.us-east-1.amazonaws.com/123456789012/test-queue',
    'https://sqs.us-east-1.amazonaws.com.evil.example/123456789012/test-queue',
  ])('refuses %s, which the SDK would use as the request host', async (queueUrl) => {
    mockSend.mockResolvedValue({ MessageId: 'id' })

    await expect(executeSqsSend({ ...CONNECTION, queueUrl, data: { ok: true } })).rejects.toThrow(
      'Queue URL must be an Amazon SQS queue URL'
    )
    expect(mockCreateSqsClient).not.toHaveBeenCalled()
  })

  it('leaves self-hosted SQS-compatible queue URLs alone', async () => {
    envFlagsMock.isHosted = false
    mockSend.mockResolvedValue({ MessageId: 'id' })

    await expect(
      executeSqsSend({
        ...CONNECTION,
        queueUrl: 'http://localhost:4566/000000000000/test-queue',
        data: { ok: true },
      })
    ).resolves.toMatchObject({ id: 'id' })
  })

  it.each([
    QUEUE_URL,
    'https://us-east-1.queue.amazonaws.com/123456789012/test-queue',
    'https://vpce-0abc-1234.sqs.us-east-1.vpce.amazonaws.com/123456789012/test-queue',
    'https://sqs.cn-north-1.amazonaws.com.cn/123456789012/test-queue',
    'https://sqs.us-east-1.api.aws/123456789012/test-queue',
    'https://sqs-fips.us-gov-west-1.amazonaws.com/123456789012/test-queue',
    'https://queue.amazonaws.com/123456789012/test-queue',
    'https://sqs.cn-north-1.api.amazonwebservices.com.cn/123456789012/test-queue',
    'https://sqs.eusc-de-east-1.amazonaws.eu/123456789012/test-queue',
  ])('accepts the AWS queue URL %s', async (queueUrl) => {
    mockSend.mockResolvedValue({ MessageId: 'id' })

    await expect(
      executeSqsSend({ ...CONNECTION, queueUrl, data: { ok: true } })
    ).resolves.toMatchObject({ id: 'id' })
  })
})
