/**
 * @vitest-environment node
 *
 * The `deploy.mcp` gate this route used to carry inline now lives on
 * `withMcpAuth`, where its twelve siblings inherit it — see
 * `lib/mcp/middleware.test.ts` for the gate itself and
 * `app/api/mcp/capability-declarations.test.ts` for what each route declares.
 * What is left here is the handler's own behavior with the gate passed.
 */
import { resetDbChainMock } from '@sim/testing'
import type { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPerformCreate } = vi.hoisted(() => ({ mockPerformCreate: vi.fn() }))

vi.mock('@/lib/mcp/middleware', () => ({
  readMcpJsonBodyWithLimit: (request: NextRequest) => request.json(),
  mcpBodyReadErrorResponse: () => null,
  withMcpAuth:
    () =>
    (
      handler: (
        request: NextRequest,
        context: {
          userId: string
          userName: string
          userEmail: string
          workspaceId: string
          requestId: string
        }
      ) => Promise<Response>
    ) =>
    (request: NextRequest) =>
      handler(request, {
        userId: 'user-1',
        userName: 'Test User',
        userEmail: 'test@example.com',
        workspaceId: 'workspace-1',
        requestId: 'request-1',
      }),
}))

vi.mock('@/lib/mcp/orchestration', () => ({
  performCreateWorkflowMcpServer: mockPerformCreate,
}))

import { POST } from '@/app/api/mcp/workflow-servers/route'

function createRequest() {
  return new Request('http://localhost:3000/api/mcp/workflow-servers?workspaceId=workspace-1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Deploy bot', workflowIds: ['workflow-1'] }),
  }) as NextRequest
}

describe('workflow MCP servers POST route', () => {
  afterAll(() => {
    resetDbChainMock()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockPerformCreate.mockResolvedValue({
      success: true,
      server: { id: 'server-1', name: 'Deploy bot' },
      addedTools: [],
    })
  })

  it('creates the server through the orchestration helper', async () => {
    const response = await POST(createRequest(), { params: Promise.resolve({}) })

    expect(response.status).toBe(201)
    expect(mockPerformCreate).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-1', name: 'Deploy bot' })
    )
  })
})
