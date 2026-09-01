/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operations = vi.hoisted(() => ({ executeVideoOperation: vi.fn() }))

vi.mock('@/lib/internal/video/operations', () => operations)

import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import { VideoOperationError } from '@/lib/internal/video/errors'
import { executeVideoTool } from '@/lib/internal/video/execute-tool'

function request(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'video_luma',
    input: { provider: 'luma', apiKey: 'key', prompt: 'A cinematic sunrise' },
    headers: new Headers(),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      workspaceId: 'workspace-1',
      executionId: 'execution-1',
      userId: 'user-1',
    },
    requestId: 'request-1',
    ...overrides,
  } as InternalToolOperationCall
}

const CASES = [
  ['video_falai', 'falai'],
  ['video_luma', 'luma'],
  ['video_minimax', 'minimax'],
  ['video_runway', 'runway'],
  ['video_veo', 'veo'],
] as const

describe('executeVideoTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    operations.executeVideoOperation.mockResolvedValue({
      videoUrl: 'https://files.example/video.mp4',
      provider: 'luma',
      model: 'ray-2',
    })
  })

  it.each(CASES)('dispatches %s through the typed %s operation', async (toolId, provider) => {
    const controller = new AbortController()
    const input = { provider, apiKey: 'key', prompt: 'A cinematic sunrise' }

    const response = await executeVideoTool(request({ toolId, input, signal: controller.signal }))

    expect(response.status).toBe(200)
    expect(operations.executeVideoOperation).toHaveBeenCalledWith(input, {
      headers: expect.any(Headers),
      requestId: 'request-1',
      signal: controller.signal,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })
  })

  it('authenticates before parsing operation input', async () => {
    const response = await executeVideoTool(
      request({ input: null, context: createExecutionContext({ workflowId: 'workflow-1' }) })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(operations.executeVideoOperation).not.toHaveBeenCalled()
  })

  it('preserves contract validation messages and details', async () => {
    const response = await executeVideoTool(request({ input: {} }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Missing required fields: provider, apiKey, and prompt',
      details: expect.any(Array),
    })
  })

  it('preserves exact operation error bodies and statuses', async () => {
    operations.executeVideoOperation.mockRejectedValue(
      new VideoOperationError('File not found', 404, {
        success: false,
        error: 'File not found',
      })
    )

    const response = await executeVideoTool(request())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ success: false, error: 'File not found' })
  })

  it('does no provider work after cancellation', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(executeVideoTool(request({ signal: controller.signal }))).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(operations.executeVideoOperation).not.toHaveBeenCalled()
  })
})
