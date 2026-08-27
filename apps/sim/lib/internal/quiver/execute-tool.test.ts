/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'

const mocks = vi.hoisted(() => ({
  executeImage: vi.fn(),
  executeText: vi.fn(),
}))

vi.mock('@/lib/internal/quiver/operations', () => ({
  executeQuiverImageToSvg: mocks.executeImage,
  executeQuiverTextToSvg: mocks.executeText,
}))

import { QuiverOperationError } from '@/lib/internal/quiver/errors'
import { executeQuiverTool } from '@/lib/internal/quiver/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function request(overrides: Partial<InternalToolOperationCall> = {}) {
  return {
    toolId: 'quiver_text_to_svg',
    input: { apiKey: 'secret', model: 'arrow-preview', prompt: 'A compass' },
    headers: new Headers(),
    context: { ...createExecutionContext({ workflowId: 'workflow-1' }), userId: 'user-1' },
    requestId: 'request-1',
    ...overrides,
  } as InternalToolOperationCall
}

describe('executeQuiverTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const result = {
      success: true,
      output: {
        file: { name: 'generated.svg' },
        files: [{ name: 'generated.svg' }],
        svgContent: '<svg />',
        id: 'generation-1',
        usage: null,
      },
    }
    mocks.executeText.mockResolvedValue(result)
    mocks.executeImage.mockResolvedValue(result)
  })

  it.each([
    ['quiver_text_to_svg', mocks.executeText],
    ['quiver_image_to_svg', mocks.executeImage],
  ])('dispatches %s to the typed operation', async (toolId, execute) => {
    const input =
      toolId === 'quiver_image_to_svg'
        ? { apiKey: 'secret', model: 'arrow-preview', image: 'https://example.com/image.png' }
        : { apiKey: 'secret', model: 'arrow-preview', prompt: 'A compass' }
    const response = await executeQuiverTool(request({ toolId, input }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ success: true })
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'secret', model: 'arrow-preview' }),
      expect.objectContaining({ userId: 'user-1', requestId: 'request-1' })
    )
  })

  it('authenticates before parsing input', async () => {
    const response = await executeQuiverTool(
      request({ input: null, context: createExecutionContext({ workflowId: 'workflow-1' }) })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ success: false, error: 'Unauthorized' })
    expect(mocks.executeText).not.toHaveBeenCalled()
  })

  it('preserves validation envelopes', async () => {
    const response = await executeQuiverTool(request({ input: {} }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: expect.any(String),
      details: expect.any(Array),
    })
  })

  it('preserves the route input byte ceiling', async () => {
    const response = await executeQuiverTool(
      request({
        input: {
          apiKey: 'secret',
          model: 'arrow-preview',
          prompt: 'x'.repeat(DEFAULT_MAX_JSON_BODY_BYTES),
        },
      })
    )

    expect(response.status).toBe(413)
    expect(mocks.executeText).not.toHaveBeenCalled()
  })

  it('projects exact operation errors', async () => {
    mocks.executeText.mockRejectedValueOnce(new QuiverOperationError('invalid model', 422))

    const response = await executeQuiverTool(request())

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ success: false, error: 'invalid model' })
  })

  it('stops before dispatch when execution is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('Execution aborted'))

    await expect(executeQuiverTool(request({ signal: controller.signal }))).rejects.toThrow(
      'Execution aborted'
    )
    expect(mocks.executeText).not.toHaveBeenCalled()
  })
})
