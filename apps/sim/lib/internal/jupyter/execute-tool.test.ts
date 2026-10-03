import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operationMocks = vi.hoisted(() => ({
  executeJupyterProxy: vi.fn(),
  executeJupyterUpload: vi.fn(),
  executeJupyterGetContent: vi.fn(),
}))

vi.mock('@/lib/internal/jupyter/operations', () => operationMocks)

import { executeJupyterTool } from '@/lib/internal/jupyter/execute-tool'
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
    operationMocks.executeJupyterProxy.mockImplementation(async () =>
      Response.json([{ id: 'kernel-1' }])
    )
    operationMocks.executeJupyterUpload.mockImplementation(async () =>
      Response.json({ success: true, output: { name: 'file.txt', path: 'file.txt' } })
    )
  })

  it('rejects non-GET v2 reads before provider work', async () => {
    const response = await executeResponse(
      createRequest({ toolId: 'jupyter_get_content_v2', input: { ...PROXY_BODY, method: 'POST' } })
    )
    expect(response.status).toBe(400)
    expect(operationMocks.executeJupyterGetContent).not.toHaveBeenCalled()
  })
})
