/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateSqsClient, mockDestroy, mockSendMessage } = vi.hoisted(() => ({
  mockCreateSqsClient: vi.fn(),
  mockDestroy: vi.fn(),
  mockSendMessage: vi.fn(),
}))

vi.mock('@/lib/internal/sqs/client', () => ({
  createSqsClient: mockCreateSqsClient,
  sendMessage: mockSendMessage,
}))

import { executeSqsSend } from '@/lib/internal/sqs/operations'

const INPUT = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
  queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue',
  data: { action: 'process' },
  messageGroupId: 'group-1',
  messageDeduplicationId: 'message-1',
}

describe('SQS operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateSqsClient.mockReturnValue({ destroy: mockDestroy })
  })

  it('forwards cancellation and destroys the AWS client after success', async () => {
    const controller = new AbortController()
    mockSendMessage.mockResolvedValue({ id: 'message-id' })

    await expect(executeSqsSend(INPUT, controller.signal)).resolves.toEqual({
      message: `Message sent to SQS queue ${INPUT.queueUrl}`,
      id: 'message-id',
    })
    expect(mockSendMessage).toHaveBeenCalledWith(
      { destroy: mockDestroy },
      INPUT.queueUrl,
      INPUT.data,
      INPUT.messageGroupId,
      INPUT.messageDeduplicationId,
      controller.signal
    )
    expect(mockDestroy).toHaveBeenCalledOnce()
  })

  it('destroys the AWS client when provider execution fails', async () => {
    mockSendMessage.mockRejectedValue(new Error('provider failure'))

    await expect(executeSqsSend(INPUT)).rejects.toThrow('provider failure')
    expect(mockDestroy).toHaveBeenCalledOnce()
  })
})
