/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createBufferPost: vi.fn(),
  editBufferPost: vi.fn(),
}))

vi.mock('@/lib/internal/buffer/operations', () => ({
  createBufferPost: mocks.createBufferPost,
  editBufferPost: mocks.editBufferPost,
}))

import { BufferOperationError } from '@/lib/internal/buffer/errors'
import { executeBufferTool } from '@/lib/internal/buffer/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function request(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'buffer_create_post',
    input: {
      apiKey: 'buffer-key',
      channelId: 'channel-1',
      text: 'Hello',
      mode: 'addToQueue',
    },
    headers: new Headers(),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      userId: 'user-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeBufferTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createBufferPost.mockResolvedValue({ success: true, output: { post: { id: 'post-1' } } })
    mocks.editBufferPost.mockResolvedValue({ success: true, output: { post: { id: 'post-1' } } })
  })

  it('dispatches create with trusted execution identity and defaults', async () => {
    const controller = new AbortController()
    const response = await executeBufferTool(request({ signal: controller.signal }))

    expect(response.status).toBe(200)
    expect(mocks.createBufferPost).toHaveBeenCalledWith(
      expect.objectContaining({ schedulingType: 'automatic', mediaType: 'auto' }),
      {
        userId: 'user-1',
        requestId: 'request-1',
        signal: controller.signal,
      }
    )
  })

  it('dispatches edit', async () => {
    const response = await executeBufferTool(
      request({
        toolId: 'buffer_edit_post',
        input: { apiKey: 'buffer-key', postId: 'post-1', mode: 'shareNow' },
      })
    )

    expect(response.status).toBe(200)
    expect(mocks.editBufferPost).toHaveBeenCalledOnce()
  })

  it('rejects invalid scheduling before provider work', async () => {
    const response = await executeBufferTool(
      request({ input: { apiKey: 'buffer-key', channelId: 'channel-1', mode: 'customScheduled' } })
    )

    expect(response.status).toBe(400)
    expect(mocks.createBufferPost).not.toHaveBeenCalled()
  })

  it('preserves operation error status', async () => {
    mocks.createBufferPost.mockRejectedValue(new BufferOperationError('File not found', 404))

    const response = await executeBufferTool(request())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ success: false, error: 'File not found' })
  })
})
