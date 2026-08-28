/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteSquareCreateCatalogImage } = vi.hoisted(() => ({
  mockExecuteSquareCreateCatalogImage: vi.fn(),
}))

vi.mock('@/lib/internal/square/operations', () => ({
  executeSquareCreateCatalogImage: mockExecuteSquareCreateCatalogImage,
}))

import { executeSquareTool } from '@/lib/internal/square/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const FILE = {
  id: 'file-1',
  key: 'workspace/workspace-1/image.png',
  name: 'image.png',
  size: 4,
  type: 'image/png',
  url: '/api/files/serve?key=image.png',
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'square_create_catalog_image',
    input: { accessToken: 'square-token', file: FILE, idempotencyKey: 'stable-key' },
    headers: new Headers(),
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

describe('executeSquareTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteSquareCreateCatalogImage.mockResolvedValue(Response.json({ success: true }))
  })

  it('dispatches typed input with trusted identity', async () => {
    const response = await executeSquareTool(createRequest())

    expect(response.status).toBe(200)
    expect(mockExecuteSquareCreateCatalogImage).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'square-token', file: FILE }),
      { userId: 'user-1', requestId: 'request-1', signal: undefined }
    )
  })

  it('rejects missing files before provider work', async () => {
    const response = await executeSquareTool(
      createRequest({ input: { accessToken: 'square-token' } })
    )

    expect(response.status).toBe(400)
    expect(mockExecuteSquareCreateCatalogImage).not.toHaveBeenCalled()
  })

  it('requires trusted execution identity', async () => {
    const response = await executeSquareTool(
      createRequest({
        context: { workflowId: 'workflow-1', workspaceId: 'workspace-1', metadata: {} },
      })
    )

    expect(response.status).toBe(401)
    expect(mockExecuteSquareCreateCatalogImage).not.toHaveBeenCalled()
  })
})
