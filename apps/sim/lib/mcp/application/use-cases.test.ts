/**
 * @vitest-environment node
 */
import type { mcpServers } from '@sim/db/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { events, mocks } = vi.hoisted(() => ({
  events: [] as string[],
  mocks: {
    loadContext: vi.fn(),
    resolvePermission: vi.fn(),
    idState: vi.fn(),
    create: vi.fn(),
    effects: vi.fn(),
    audit: vi.fn(),
  },
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  loadActiveWorkspaceContext: mocks.loadContext,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) =>
    actual === 'admin' || actual === required || (actual === 'write' && required === 'read'),
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@sim/audit', () => ({
  AuditAction: {
    MCP_SERVER_ADDED: 'mcp_server.added',
    MCP_SERVER_UPDATED: 'mcp_server.updated',
    MCP_SERVER_REMOVED: 'mcp_server.removed',
  },
  AuditResourceType: { MCP_SERVER: 'mcp_server' },
  recordAudit: mocks.audit,
}))
vi.mock('@/lib/mcp/orchestration', () => ({
  applyMcpServerMutationEffects: mocks.effects,
  createMcpServer: mocks.create,
  deleteMcpServer: vi.fn(),
  updateMcpServer: vi.fn(),
}))
vi.mock('@/lib/mcp/queries', () => ({
  getMcpServerIdState: mocks.idState,
  getWorkspaceMcpServer: vi.fn(),
  listWorkspaceMcpServers: vi.fn(),
}))

import { createMcpServerUseCase, discoverMcpToolsUseCase } from '@/lib/mcp/application/use-cases'

type McpServerRow = typeof mcpServers.$inferSelect
const workspace = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'owner-1',
}
const server = {
  id: 'mcp-server-1',
  workspaceId: workspace.workspaceId,
  createdBy: 'owner-1',
  name: 'Docs server',
  description: null,
  transport: 'streamable-http',
  url: 'https://mcp.example.com/sse',
  authType: 'headers',
  oauthClientId: null,
  oauthClientSecret: null,
  headers: {},
  timeout: 30_000,
  retries: 3,
  enabled: true,
  lastConnected: null,
  connectionStatus: 'connected',
  lastError: null,
  statusConfig: {},
  toolCount: 0,
  lastToolsRefresh: null,
  totalRequests: 0,
  lastUsed: null,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
} as McpServerRow

describe('MCP server application use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    events.length = 0
    mocks.loadContext.mockResolvedValue(workspace)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.idState.mockResolvedValue(null)
    mocks.create.mockResolvedValue({
      success: true,
      serverId: server.id,
      server,
      updated: false,
    })
    mocks.audit.mockImplementation(() => events.push('audit'))
    mocks.effects.mockImplementation(async () => events.push('effects'))
  })

  it('keeps strict creation, compatibility attribution, audit, and effects in order', async () => {
    const principal = {
      kind: 'workspace_api_key' as const,
      workspaceId: workspace.workspaceId,
      keyId: 'workspace-key-1',
    }

    const result = await createMcpServerUseCase.execute({
      principal,
      input: {
        workspaceId: workspace.workspaceId,
        name: server.name,
        url: server.url,
        source: 'api',
      },
    })

    expect(result.server.id).toBe(server.id)
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: workspace.workspaceId,
        userId: workspace.billedAccountUserId,
        existingServerBehavior: 'reject',
      })
    )
    expect(events).toEqual(['audit', 'effects'])
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        metadata: expect.objectContaining({ operation: 'mcp_servers.create' }),
      })
    )
  })

  it('rejects an existing live URL before mutation and audit', async () => {
    mocks.idState.mockResolvedValueOnce({ deleted: false })

    await expect(
      createMcpServerUseCase.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: workspace.workspaceId, name: server.name, url: server.url },
      })
    ).rejects.toMatchObject({ code: 'conflict' })

    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.effects).not.toHaveBeenCalled()
  })

  it('rejects workspace-key tool discovery before protected loading', async () => {
    await expect(
      discoverMcpToolsUseCase.execute({
        principal: {
          kind: 'workspace_api_key',
          workspaceId: workspace.workspaceId,
          keyId: 'workspace-key-1',
        },
        input: { workspaceId: workspace.workspaceId },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.loadContext).not.toHaveBeenCalled()
  })

  it('fails fast when a post-audit domain effect fails', async () => {
    mocks.effects.mockRejectedValueOnce(new Error('cache unavailable'))

    await expect(
      createMcpServerUseCase.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: workspace.workspaceId, name: server.name, url: server.url },
      })
    ).rejects.toThrow('cache unavailable')

    expect(mocks.audit).toHaveBeenCalledOnce()
  })
})
