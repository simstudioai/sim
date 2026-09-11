/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operationMocks = vi.hoisted(() => ({
  executeJupyterProxy: vi.fn(),
  executeJupyterUpload: vi.fn(),
  executeJupyterGetContent: vi.fn(),
}))

vi.mock('@/lib/internal/jupyter/operations', () => operationMocks)

import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { executeJupyterTool, JUPYTER_PROXY_TOOL_IDS } from '@/lib/internal/jupyter/execute-tool'
import { createInternalToolFileResult } from '@/lib/internal/tool-operations/file-result'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const PROXY_BODY = {
  serverUrl: 'http://jupyter.example.com:8888',
  token: 'token',
  method: 'GET' as const,
  path: 'kernels',
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'jupyter_list_kernels',
    input: PROXY_BODY,
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      workspaceId: 'workspace-1',
      userId: 'user-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

async function executeResponse(request: InternalToolOperationCall): Promise<Response> {
  const response = await executeJupyterTool(request)
  if (!(response instanceof Response)) throw new Error('Expected a JSON response')
  return response
}

describe('executeJupyterTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    operationMocks.executeJupyterProxy.mockImplementation(async () =>
      Response.json([{ id: 'kernel-1' }])
    )
    operationMocks.executeJupyterUpload.mockImplementation(async () =>
      Response.json({ success: true, output: { name: 'file.txt', path: 'file.txt' } })
    )
  })

  it.each(JUPYTER_PROXY_TOOL_IDS)('recognizes proxy tool ID %s', async (toolId) => {
    const response = await executeResponse(createRequest({ toolId }))

    expect(response.status).toBe(200)
    expect(operationMocks.executeJupyterProxy).toHaveBeenCalledWith(PROXY_BODY, {
      requestId: 'request-1',
      signal: undefined,
    })
  })

  it('validates the canonical proxy contract before provider work', async () => {
    const response = await executeResponse(createRequest({ input: { ...PROXY_BODY, path: '' } }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(operationMocks.executeJupyterProxy).not.toHaveBeenCalled()
  })

  it('dispatches upload with trusted user context and cancellation', async () => {
    const controller = new AbortController()
    const input = {
      serverUrl: 'http://jupyter.example.com:8888',
      token: 'token',
      fileContent: Buffer.from('hello').toString('base64'),
      fileName: 'hello.txt',
    }

    const response = await executeResponse(
      createRequest({
        toolId: 'jupyter_upload_file',
        input,
        signal: controller.signal,
      })
    )

    expect(response.status).toBe(200)
    expect(operationMocks.executeJupyterUpload).toHaveBeenCalledWith(input, {
      userId: 'user-1',
      requestId: 'request-1',
      signal: controller.signal,
    })
  })

  it('fails upload closed without a trusted execution user', async () => {
    const response = await executeResponse(
      createRequest({
        toolId: 'jupyter_upload_file',
        context: {
          ...createExecutionContext({ workflowId: 'workflow-1' }),
          workspaceId: 'workspace-1',
        },
      })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ success: false, error: 'Unauthorized' })
    expect(operationMocks.executeJupyterUpload).not.toHaveBeenCalled()
  })

  it('propagates cancellation before provider work starts', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeJupyterTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(operationMocks.executeJupyterProxy).not.toHaveBeenCalled()
  })

  it('returns a deterministic error for unsupported IDs', async () => {
    const response = await executeResponse(createRequest({ toolId: 'jupyter_unknown' }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Unsupported Jupyter tool: jupyter_unknown',
    })
  })

  it('preserves the typed v2 file result for central storage', async () => {
    const result = createInternalToolFileResult(
      { buffer: Buffer.from('hello'), name: 'notes.txt', mimeType: 'text/plain' },
      (file) => ({ success: true, output: { file } })
    )
    const input = { ...PROXY_BODY, path: 'notes.txt' }
    const controller = new AbortController()
    operationMocks.executeJupyterGetContent.mockResolvedValue(result)
    expect(
      await executeJupyterTool(
        createRequest({ toolId: 'jupyter_get_content_v2', input, signal: controller.signal })
      )
    ).toBe(result)
    expect(operationMocks.executeJupyterGetContent).toHaveBeenCalledWith(input, {
      requestId: 'request-1',
      signal: controller.signal,
    })
    expect(operationMocks.executeJupyterProxy).not.toHaveBeenCalled()
  })

  it('rejects non-GET v2 reads before provider work', async () => {
    const response = await executeResponse(
      createRequest({ toolId: 'jupyter_get_content_v2', input: { ...PROXY_BODY, method: 'POST' } })
    )
    expect(response.status).toBe(400)
    expect(operationMocks.executeJupyterGetContent).not.toHaveBeenCalled()
  })

  it('projects a download byte limit failure as 413', async () => {
    operationMocks.executeJupyterGetContent.mockRejectedValue(
      new PayloadSizeLimitError({ label: 'Jupyter file download', maxBytes: 100 * 1024 * 1024 })
    )
    const response = await executeResponse(createRequest({ toolId: 'jupyter_get_content_v2' }))
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('Jupyter file download exceeds maximum size'),
    })
  })
})
