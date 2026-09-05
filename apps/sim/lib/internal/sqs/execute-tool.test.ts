/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteSqsSend, mockExecuteSqsReceiveMessage, mockOperations } = vi.hoisted(() => {
  const names = [
    'executeSqsCancelMessageMoveTask',
    'executeSqsChangeMessageVisibility',
    'executeSqsChangeMessageVisibilityBatch',
    'executeSqsCreateQueue',
    'executeSqsDeleteMessage',
    'executeSqsDeleteMessageBatch',
    'executeSqsDeleteQueue',
    'executeSqsGetQueueAttributes',
    'executeSqsGetQueueUrl',
    'executeSqsListDeadLetterSourceQueues',
    'executeSqsListMessageMoveTasks',
    'executeSqsListQueues',
    'executeSqsListQueueTags',
    'executeSqsPurgeQueue',
    'executeSqsReceiveMessage',
    'executeSqsSend',
    'executeSqsSendMessageBatch',
    'executeSqsSetQueueAttributes',
    'executeSqsStartMessageMoveTask',
    'executeSqsTagQueue',
    'executeSqsUntagQueue',
  ]
  const operations: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const name of names) operations[name] = vi.fn()
  return {
    mockOperations: operations,
    mockExecuteSqsSend: operations.executeSqsSend,
    mockExecuteSqsReceiveMessage: operations.executeSqsReceiveMessage,
  }
})

vi.mock('@/lib/internal/sqs/operations', () => mockOperations)

import { executeSqsTool } from '@/lib/internal/sqs/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue'

const BODY = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
  queueUrl: QUEUE_URL,
  data: { action: 'process' },
  messageGroupId: 'group-1',
  messageDeduplicationId: 'message-1',
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'sqs_send',
    input: BODY,
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeSqsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validates and executes the SQS send operation', async () => {
    const controller = new AbortController()
    const result = { message: `Message sent to SQS queue ${QUEUE_URL}`, id: 'message-id' }
    mockExecuteSqsSend.mockResolvedValue(result)

    const response = await executeSqsTool(createRequest({ signal: controller.signal }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(result)
    expect(mockExecuteSqsSend).toHaveBeenCalledWith(BODY, controller.signal)
  })

  it('dispatches each tool id to its own operation', async () => {
    mockExecuteSqsReceiveMessage.mockResolvedValue({ messages: [], count: 0 })

    const response = await executeSqsTool(
      createRequest({
        toolId: 'sqs_receive_message',
        input: {
          region: 'us-east-1',
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
          queueUrl: QUEUE_URL,
          waitTimeSeconds: 20,
        },
      })
    )

    expect(response.status).toBe(200)
    expect(mockExecuteSqsReceiveMessage).toHaveBeenCalledOnce()
    expect(mockExecuteSqsSend).not.toHaveBeenCalled()
  })

  it('returns the route-compatible validation envelope before provider work', async () => {
    const response = await executeSqsTool(createRequest({ input: { ...BODY, data: {} } }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(mockExecuteSqsSend).not.toHaveBeenCalled()
  })

  it('rejects an out-of-range receive batch size before provider work', async () => {
    const response = await executeSqsTool(
      createRequest({
        toolId: 'sqs_receive_message',
        input: {
          region: 'us-east-1',
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
          queueUrl: QUEUE_URL,
          maxNumberOfMessages: 25,
        },
      })
    )

    expect(response.status).toBe(400)
    expect(mockExecuteSqsReceiveMessage).not.toHaveBeenCalled()
  })

  it('rejects a Binary message attribute, which has no JSON-safe value form', async () => {
    const response = await executeSqsTool(
      createRequest({
        input: {
          ...BODY,
          messageAttributes: { thumbnail: { dataType: 'Binary', stringValue: 'AAAA' } },
        },
      })
    )

    expect(response.status).toBe(400)
    expect(mockExecuteSqsSend).not.toHaveBeenCalled()
  })

  it('accepts a custom-labelled Number message attribute', async () => {
    mockExecuteSqsSend.mockResolvedValue({ message: 'sent', id: 'message-id' })

    const response = await executeSqsTool(
      createRequest({
        input: {
          ...BODY,
          messageAttributes: { ratio: { dataType: 'Number.float', stringValue: '1.5' } },
        },
      })
    )

    expect(response.status).toBe(200)
    expect(mockExecuteSqsSend).toHaveBeenCalledOnce()
  })

  it('rejects the read-only All pseudo-name on a queue attribute write', async () => {
    const response = await executeSqsTool(
      createRequest({
        toolId: 'sqs_set_queue_attributes',
        input: {
          region: 'us-east-1',
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
          queueUrl: QUEUE_URL,
          attributes: { All: 'true' },
        },
      })
    )

    expect(response.status).toBe(400)
    expect(mockOperations.executeSqsSetQueueAttributes).not.toHaveBeenCalled()
  })

  it('accepts a real settable queue attribute', async () => {
    mockOperations.executeSqsSetQueueAttributes.mockResolvedValue({ message: 'updated' })

    const response = await executeSqsTool(
      createRequest({
        toolId: 'sqs_set_queue_attributes',
        input: {
          region: 'us-east-1',
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
          queueUrl: QUEUE_URL,
          attributes: { VisibilityTimeout: '60' },
        },
      })
    )

    expect(response.status).toBe(200)
    expect(mockOperations.executeSqsSetQueueAttributes).toHaveBeenCalledOnce()
  })

  it('preserves the provider error envelope', async () => {
    mockExecuteSqsSend.mockRejectedValue(new Error('AWS rejected credentials'))

    const response = await executeSqsTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'SQS send message failed: AWS rejected credentials',
    })
  })

  it('rejects an unsupported SQS tool id', async () => {
    const response = await executeSqsTool(createRequest({ toolId: 'sqs_not_a_tool' }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Unsupported SQS tool: sqs_not_a_tool',
    })
  })

  it('propagates cancellation without starting provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeSqsTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockExecuteSqsSend).not.toHaveBeenCalled()
  })
})
