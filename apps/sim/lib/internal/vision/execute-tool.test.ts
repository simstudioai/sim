/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'

const executeVisionOperation = vi.hoisted(() => vi.fn())

vi.mock('@/lib/internal/vision/operations', () => ({ executeVisionOperation }))

import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import { VisionOperationError } from '@/lib/internal/vision/errors'
import { executeVisionTool } from '@/lib/internal/vision/execute-tool'

function toolRequest(overrides: Partial<InternalToolOperationCall> = {}) {
  return {
    toolId: 'vision_tool',
    input: {
      apiKey: 'secret',
      imageUrl: 'https://images.example.com/a.png',
      imageFile: null,
      model: 'gpt-5.2',
      prompt: null,
    },
    headers: new Headers(),
    context: { ...createExecutionContext({ workflowId: 'workflow-1' }), userId: 'user-1' },
    requestId: 'request-1',
    ...overrides,
  } as InternalToolOperationCall
}

describe('executeVisionTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    executeVisionOperation.mockResolvedValue({ content: 'A lighthouse', model: 'gpt-5.2' })
  })

  it.each(['vision_tool', 'vision_tool_v2'])(
    'dispatches %s to the shared operation',
    async (toolId) => {
      const response = await executeVisionTool(toolRequest({ toolId }))

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        success: true,
        output: { content: 'A lighthouse', model: 'gpt-5.2' },
      })
      expect(executeVisionOperation).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'secret', model: 'gpt-5.2' }),
        expect.objectContaining({ userId: 'user-1', requestId: 'request-1' })
      )
    }
  )

  it('authenticates before parsing input', async () => {
    const response = await executeVisionTool(
      toolRequest({
        input: null,
        context: createExecutionContext({ workflowId: 'workflow-1' }),
      })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Authentication required',
    })
    expect(executeVisionOperation).not.toHaveBeenCalled()
  })

  it('preserves contract validation errors', async () => {
    const response = await executeVisionTool(toolRequest({ input: {} }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Validation error',
      details: expect.any(Array),
    })
  })

  it('preserves the route input byte ceiling', async () => {
    const response = await executeVisionTool(
      toolRequest({ input: { apiKey: 'secret', prompt: 'x'.repeat(DEFAULT_MAX_JSON_BODY_BYTES) } })
    )

    expect(response.status).toBe(413)
    expect(executeVisionOperation).not.toHaveBeenCalled()
  })

  it('stops before dispatch when execution is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('Execution aborted'))

    await expect(executeVisionTool(toolRequest({ signal: controller.signal }))).rejects.toThrow(
      'Execution aborted'
    )
    expect(executeVisionOperation).not.toHaveBeenCalled()
  })

  it('projects exact typed error envelopes', async () => {
    executeVisionOperation.mockRejectedValueOnce(
      new VisionOperationError('Either imageUrl or imageFile is required', 400)
    )

    const response = await executeVisionTool(toolRequest())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Either imageUrl or imageFile is required',
    })
  })
})
