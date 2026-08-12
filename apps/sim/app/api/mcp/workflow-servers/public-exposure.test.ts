/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    /** Mutable so a test can decide whether the server is already public. */
    currentServer: { id: 'srv-1', workspaceId: 'workspace-1', isPublic: false } as Record<
      string,
      unknown
    >,
    body: {} as Record<string, unknown>,
    getUserEntityPermissions: vi.fn(),
    createServer: vi.fn(),
    updateServer: vi.fn(),
    errorResponse: vi.fn(),
  },
}))

/**
 * `withMcpAuth('write')` is the only authorization these routes carry, so the
 * stub grants exactly that: a `write` caller who has already passed auth. What
 * is under test is whether the public-exposure gate runs *after* it.
 */
vi.mock('@/lib/mcp/middleware', () => ({
  withMcpAuth: () => (handler: unknown) => (request: unknown, routeContext: unknown) =>
    (handler as (r: unknown, c: Record<string, string>, rc: unknown) => Promise<unknown>)(
      request,
      {
        userId: 'editor-1',
        userName: 'Editor',
        userEmail: 'editor@example.com',
        workspaceId: 'workspace-1',
        requestId: 'req-1',
      },
      routeContext
    ),
  readMcpJsonBodyWithLimit: async () => mocks.body,
  mcpBodyReadErrorResponse: () => null,
}))

vi.mock('@/lib/mcp/utils', () => ({
  createMcpErrorResponse: (_error: unknown, message: string, status: number) =>
    mocks.errorResponse({ message, status }) ?? { message, status },
  createMcpSuccessResponse: (data: unknown) => ({ status: 200, data }),
  mcpOrchestrationStatus: () => 500,
}))

vi.mock('@/lib/mcp/orchestration', () => ({
  performCreateWorkflowMcpServer: mocks.createServer,
  performUpdateWorkflowMcpServer: mocks.updateServer,
  performDeleteWorkflowMcpServer: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mocks.getUserEntityPermissions,
}))

vi.mock('@sim/db', () => {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'from', 'where', 'limit']) {
    chain[method] = vi.fn(() => chain)
  }
  ;(chain as { then?: unknown }).then = (resolve: (rows: unknown[]) => unknown) =>
    resolve([mocks.currentServer])
  return { db: chain }
})

vi.mock('@sim/db/schema', () => ({
  workflowMcpServer: { id: {}, workspaceId: {}, deletedAt: {}, isPublic: {} },
  workflowMcpTool: {},
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn(),
}))

import { PATCH } from '@/app/api/mcp/workflow-servers/[id]/route'
import { POST } from '@/app/api/mcp/workflow-servers/route'

const request = {} as never
const routeContext = { params: Promise.resolve({ id: 'srv-1' }) } as never

/**
 * These routes call the orchestration layer directly rather than the
 * application use case, so the use case's admin gate does not cover them. A
 * public server needs no authentication to invoke, so a `write` member must not
 * be able to publish one through the settings UI, which is what these hit.
 */
describe('workflow MCP server REST routes gate public exposure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.currentServer.isPublic = false
    mocks.createServer.mockResolvedValue({
      success: true,
      server: { id: 'srv-1', name: 'srv' },
      addedTools: [],
    })
    mocks.updateServer.mockResolvedValue({
      success: true,
      server: { id: 'srv-1', name: 'renamed' },
      updatedFields: ['name'],
    })
  })

  it('rejects a write member creating a public server', async () => {
    mocks.getUserEntityPermissions.mockResolvedValue('write')
    mocks.body = { name: 'srv', isPublic: true }

    const response = (await POST(request, routeContext)) as { status: number }

    expect(response.status).toBe(403)
    expect(mocks.createServer).not.toHaveBeenCalled()
  })

  it('allows an admin creating a public server', async () => {
    mocks.getUserEntityPermissions.mockResolvedValue('admin')
    mocks.body = { name: 'srv', isPublic: true }

    await POST(request, routeContext)

    expect(mocks.createServer).toHaveBeenCalledWith(expect.objectContaining({ isPublic: true }))
  })

  it('allows a write member creating a private server', async () => {
    mocks.getUserEntityPermissions.mockResolvedValue('write')
    mocks.body = { name: 'srv', isPublic: false }

    await POST(request, routeContext)

    expect(mocks.createServer).toHaveBeenCalled()
  })

  it('rejects a write member flipping a private server to public', async () => {
    mocks.getUserEntityPermissions.mockResolvedValue('write')
    mocks.body = { isPublic: true }

    const response = (await PATCH(request, routeContext)) as { status: number }

    expect(response.status).toBe(403)
    expect(mocks.updateServer).not.toHaveBeenCalled()
  })

  it('allows a write member renaming an already-public server', async () => {
    mocks.currentServer.isPublic = true
    mocks.getUserEntityPermissions.mockResolvedValue('write')
    mocks.body = { name: 'renamed', isPublic: true }

    await PATCH(request, routeContext)

    expect(mocks.updateServer).toHaveBeenCalledWith(expect.objectContaining({ name: 'renamed' }))
  })

  it('allows a write member making a public server private', async () => {
    mocks.currentServer.isPublic = true
    mocks.getUserEntityPermissions.mockResolvedValue('write')
    mocks.body = { isPublic: false }

    await PATCH(request, routeContext)

    expect(mocks.updateServer).toHaveBeenCalled()
    expect(mocks.getUserEntityPermissions).not.toHaveBeenCalled()
  })
})
