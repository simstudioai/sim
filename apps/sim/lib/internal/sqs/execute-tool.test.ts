/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteSqsSend } = vi.hoisted(() => ({
  mockExecuteSqsSend: vi.fn(),
}))

vi.mock('@/lib/internal/sqs/operations', () => ({
  executeSqsSend: mockExecuteSqsSend,
}))

import { executeSqsTool } from '@/lib/internal/sqs/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const BODY = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
  queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue',
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
      metadata: {},
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
    const result = { message: `Message sent to SQS queue ${BODY.queueUrl}`, id: 'message-id' }
    mockExecuteSqsSend.mockResolvedValue(result)

    const response = await executeSqsTool(createRequest({ signal: controller.signal }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(result)
    expect(mockExecuteSqsSend).toHaveBeenCalledWith(BODY, controller.signal)
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

  it('preserves the provider error envelope', async () => {
    mockExecuteSqsSend.mockRejectedValue(new Error('AWS rejected credentials'))

    const response = await executeSqsTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'SQS send message failed: AWS rejected credentials',
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
