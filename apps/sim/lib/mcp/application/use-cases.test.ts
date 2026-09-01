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
    getServer: vi.fn(),
    listServers: vi.fn(),
    discoverServerTools: vi.fn(),
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
  getWorkspaceMcpServer: mocks.getServer,
  listWorkspaceMcpServers: mocks.listServers,
}))
vi.mock('@/lib/mcp/service', () => ({
  mcpService: { discoverTools: vi.fn(), discoverServerTools: mocks.discoverServerTools },
}))

import {
  createMcpServerUseCase,
  discoverMcpServerToolsUseCase,
  discoverMcpToolsUseCase,
  listMcpServersUseCase,
} from '@/lib/mcp/application/use-cases'

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
    mocks.getServer.mockResolvedValue(server)
    mocks.listServers.mockResolvedValue({ data: [server], nextCursorKeys: null })
    mocks.discoverServerTools.mockResolvedValue([])
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

  /**
   * The message reaches the REST API and the CLI alike, so it names the
   * operation and the server it collided with rather than an HTTP endpoint only
   * one of those two callers can reach.
   */
  it('rejects an existing live URL before mutation and audit', async () => {
    mocks.idState.mockResolvedValueOnce({ deleted: false })

    await expect(
      createMcpServerUseCase.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: workspace.workspaceId, name: server.name, url: server.url },
      })
    ).rejects.toMatchObject({
      code: 'conflict',
      message: expect.stringContaining('Update that server instead of creating a new one'),
    })

    mocks.idState.mockResolvedValueOnce({ deleted: false })
    await expect(
      createMcpServerUseCase.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: workspace.workspaceId, name: server.name, url: server.url },
      })
    ).rejects.toMatchObject({ message: expect.not.stringMatching(/\/api\/v2\//) })

    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.effects).not.toHaveBeenCalled()
  })

  /**
   * A server id is derived from the workspace and endpoint URL, so re-registering
   * a URL that was soft-deleted reuses the same row. That is a create from the
   * caller's side — the resource they asked for did not exist a moment ago — so it
   * must succeed with the create's 201 rather than collide with its own tombstone.
   * The conflict guard therefore keys on the id state's `deleted` flag, not on
   * whether the writer reported an update.
   */
  it('creates over a soft-deleted registration rather than colliding with its tombstone', async () => {
    mocks.idState.mockResolvedValueOnce({ deleted: true })
    mocks.create.mockResolvedValueOnce({
      success: true,
      serverId: server.id,
      server,
      updated: true,
    })

    const result = await createMcpServerUseCase.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: workspace.workspaceId, name: server.name, url: server.url },
    })

    expect(result.server.id).toBe(server.id)
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ existingServerBehavior: 'reject' })
    )
    expect(events).toEqual(['audit', 'effects'])
  })

  /**
   * The pre-check reads the id state outside the write, so two concurrent creates
   * of the same URL can both pass it. The unique index is what actually decides,
   * and its `23505` must surface as the same conflict the pre-check reports —
   * otherwise the loser of the race gets a 500 for a condition the API defines.
   */
  it('reports the unique-index loser of a concurrent create as a conflict', async () => {
    mocks.create.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
    )

    await expect(
      createMcpServerUseCase.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: workspace.workspaceId, name: server.name, url: server.url },
      })
    ).rejects.toMatchObject({ code: 'conflict' })

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

  it('rejects workspace-key per-server tool discovery before protected loading', async () => {
    await expect(
      discoverMcpServerToolsUseCase.execute({
        principal: {
          kind: 'workspace_api_key',
          workspaceId: workspace.workspaceId,
          keyId: 'workspace-key-1',
        },
        input: { workspaceId: workspace.workspaceId, serverId: server.id },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.loadContext).not.toHaveBeenCalled()
    expect(mocks.discoverServerTools).not.toHaveBeenCalled()
  })

  it('resolves the server in the caller workspace before reaching the network', async () => {
    mocks.getServer.mockResolvedValueOnce(null)

    await expect(
      discoverMcpServerToolsUseCase.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: workspace.workspaceId, serverId: 'mcp-from-another-workspace' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mocks.discoverServerTools).not.toHaveBeenCalled()
  })

  it('answers a disabled server with a conflict instead of an untyped fault', async () => {
    mocks.getServer.mockResolvedValueOnce({ ...server, enabled: false })

    await expect(
      discoverMcpServerToolsUseCase.execute({
        principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
        input: { workspaceId: workspace.workspaceId, serverId: server.id },
      })
    ).rejects.toMatchObject({ code: 'conflict' })

    /**
     * Discovery loads its configuration through a query that filters on
     * `enabled`, so reaching it raised a plain `Error` — rendered as a 500 for
     * a documented registration value — and stamped a bogus failure on the row.
     */
    expect(mocks.discoverServerTools).not.toHaveBeenCalled()
  })

  it('discovers one server tools for the acting subject, honouring refresh', async () => {
    const tools = [
      {
        name: 'search_docs',
        inputSchema: { type: 'object' },
        serverId: server.id,
        serverName: server.name,
      },
    ]
    mocks.discoverServerTools.mockResolvedValueOnce(tools)

    const result = await discoverMcpServerToolsUseCase.execute({
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      input: { workspaceId: workspace.workspaceId, serverId: server.id, refresh: true },
    })

    expect(result.tools).toBe(tools)
    /**
     * A public `refresh` skips the positive cache but must keep the failure
     * cooldown: `force` would let one API key drive a connection attempt per
     * request at an endpoint already known to be failing, from Sim's egress
     * addresses.
     */
    expect(mocks.discoverServerTools).toHaveBeenCalledWith(
      'user-1',
      server.id,
      workspace.workspaceId,
      'skip-cache'
    )
  })

  it('bounds the server list by the caller limit and reports the resuming keys', async () => {
    mocks.listServers.mockResolvedValueOnce({
      data: [server],
      nextCursorKeys: ['2026-01-01T00:00:00.000Z', server.id],
    })

    const result = await listMcpServersUseCase.execute({
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      input: { workspaceId: workspace.workspaceId, limit: 1 },
    })

    expect(mocks.listServers).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: workspace.workspaceId, limit: 1 })
    )
    expect(result).toMatchObject({
      servers: [server],
      nextCursorKeys: ['2026-01-01T00:00:00.000Z', server.id],
      sortBy: 'createdAt',
      sortOrder: 'desc',
    })
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
