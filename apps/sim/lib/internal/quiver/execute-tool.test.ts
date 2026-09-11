/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { createInternalToolFileResult } from '@/lib/internal/tool-operations/file-result'

const mocks = vi.hoisted(() => ({
  executeImage: vi.fn(),
  executeText: vi.fn(),
}))

vi.mock('@/lib/internal/quiver/operations', () => ({
  executeQuiverImageToSvg: mocks.executeImage,
  executeQuiverTextToSvg: mocks.executeText,
}))

import { QuiverOperationError } from '@/lib/internal/quiver/errors'
import { executeQuiverTool as executeQuiverToolOperation } from '@/lib/internal/quiver/execute-tool'
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

async function executeQuiverTool(
  request: Parameters<typeof executeQuiverToolOperation>[0]
): Promise<Response> {
  const result = await executeQuiverToolOperation(request)
  if (!(result instanceof Response)) throw new Error('Expected a JSON response')
  return result
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

  it('forwards binary file results without serializing them', async () => {
    const result = createInternalToolFileResult(
      { buffer: Buffer.from('file'), name: 'file.txt', mimeType: 'text/plain' },
      (file) => ({ file })
    )
    mocks.executeText.mockResolvedValueOnce(result)
    expect(await executeQuiverToolOperation(request({ toolId: 'quiver_text_to_svg_v2' }))).toBe(
      result
    )
    expect(mocks.executeText.mock.calls[0]?.[2]).toBe('v2')
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

  it.each([
    ['quiver_text_to_svg_v2', mocks.executeText],
    ['quiver_image_to_svg_v2', mocks.executeImage],
  ])('selects the stored file projection for %s', async (toolId, execute) => {
    const input =
      toolId === 'quiver_image_to_svg_v2'
        ? { apiKey: 'secret', model: 'arrow-preview', image: 'https://example.com/image.png' }
        : { apiKey: 'secret', model: 'arrow-preview', prompt: 'A compass' }
    const result = createInternalToolFileResult(
      { buffer: Buffer.from('<svg />'), name: 'file.svg', mimeType: 'image/svg+xml' },
      (file) => ({ success: true, output: { file, files: [file] } })
    )
    execute.mockResolvedValueOnce(result)

    expect(await executeQuiverToolOperation(request({ toolId, input }))).toBe(result)
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'secret', model: 'arrow-preview' }),
      expect.objectContaining({ userId: 'user-1', requestId: 'request-1' }),
      'v2'
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
