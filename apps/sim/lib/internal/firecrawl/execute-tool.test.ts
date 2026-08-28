/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteFirecrawlParse } = vi.hoisted(() => ({
  mockExecuteFirecrawlParse: vi.fn(),
}))

vi.mock('@/lib/internal/firecrawl/operations', () => ({
  executeFirecrawlParse: mockExecuteFirecrawlParse,
}))

import { executeFirecrawlTool } from '@/lib/internal/firecrawl/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const FILE = {
  key: 'workspace/workspace-1/document.pdf',
  name: 'document.pdf',
  size: 42,
  type: 'application/pdf',
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'firecrawl_parse',
    input: { apiKey: 'firecrawl-key', file: FILE, options: { formats: ['markdown'] } },
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

describe('executeFirecrawlTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteFirecrawlParse.mockResolvedValue(Response.json({ success: true }))
  })

  it('dispatches typed input and provenance headers with trusted identity', async () => {
    const request = createRequest()
    const response = await executeFirecrawlTool(request)

    expect(response.status).toBe(200)
    expect(mockExecuteFirecrawlParse).toHaveBeenCalledWith(request.input, {
      headers: request.headers,
      userId: 'user-1',
      requestId: 'request-1',
      signal: undefined,
    })
  })

  it('requires trusted execution identity', async () => {
    const response = await executeFirecrawlTool(
      createRequest({
        context: { workflowId: 'workflow-1', workspaceId: 'workspace-1', metadata: {} },
      })
    )

    expect(response.status).toBe(401)
    expect(mockExecuteFirecrawlParse).not.toHaveBeenCalled()
  })
})
