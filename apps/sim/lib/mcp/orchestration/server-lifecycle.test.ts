/**
 * @vitest-environment node
 */
import {
  auditMock,
  auditMockFns,
  dbChainMock,
  dbChainMockFns,
  encryptionMock,
  posthogServerMock,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockClearCache,
  mockOauthCredsChanged,
  mockRevokeOauthTokens,
  mockEvictServerConnections,
  mockGenerateMcpServerId,
} = vi.hoisted(() => ({
  mockClearCache: vi.fn(),
  mockOauthCredsChanged: vi.fn(),
  mockRevokeOauthTokens: vi.fn(),
  mockEvictServerConnections: vi.fn(),
  mockGenerateMcpServerId: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/db', () => ({
  ...dbChainMock,
  mcpServers: schemaMock.mcpServers,
}))
vi.mock('@sim/db/schema', () => ({
  mcpServerOauth: schemaMock.mcpServerOauth,
}))
vi.mock('@sim/utils/id', () => ({ generateId: vi.fn() }))
vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/mcp/domain-check', () => ({
  McpDnsResolutionError: class extends Error {},
  McpDomainNotAllowedError: class extends Error {},
  McpSsrfError: class extends Error {},
  validateMcpDomain: vi.fn(),
  validateMcpServerSsrf: vi.fn(),
}))
vi.mock('@/lib/mcp/oauth', () => ({
  detectMcpAuthType: vi.fn(),
  oauthCredsChanged: mockOauthCredsChanged,
  revokeMcpOauthTokens: mockRevokeOauthTokens,
}))
vi.mock('@/lib/mcp/service', () => ({
  mcpService: {
    clearCache: mockClearCache,
    evictServerConnections: mockEvictServerConnections,
  },
}))
vi.mock('@/lib/mcp/utils', () => ({ generateMcpServerId: mockGenerateMcpServerId }))
vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { AuditAction } from '@sim/audit'
import {
  performCreateMcpServer,
  performDeleteMcpServer,
  performUpdateMcpServer,
} from '@/lib/mcp/orchestration/server-lifecycle'

describe('MCP server lifecycle orchestration', () => {
  const auditUpdatedFields = (): string[] | undefined =>
    auditMockFns.mockRecordAudit.mock.calls.at(-1)?.[0].metadata.updatedFields
  const auditAction = (): string | undefined =>
    auditMockFns.mockRecordAudit.mock.calls.at(-1)?.[0].action
  const auditMetadata = (): Record<string, unknown> | undefined =>
    auditMockFns.mockRecordAudit.mock.calls.at(-1)?.[0].metadata

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockOauthCredsChanged.mockResolvedValue(false)
  })

  it('clears the workspace cache when an OAuth client ID implicitly changes the auth type', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        url: 'https://example.com/mcp',
        authType: 'headers',
        oauthClientId: 'client-1',
        oauthClientSecret: null,
      },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        id: 'server-1',
        workspaceId: 'workspace-1',
        name: 'Example',
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        authType: 'oauth',
      },
    ])

    const result = await performUpdateMcpServer({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      serverId: 'server-1',
      oauthClientId: 'client-1',
      oauthClientIdProvided: true,
    })

    expect(result.success).toBe(true)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(expect.objectContaining({ authType: 'oauth' }))
    // Flipping to OAuth must reset to disconnected — it hasn't completed an auth flow.
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionStatus: 'disconnected',
        lastConnected: null,
        lastError: null,
      })
    )
    expect(result.configurationChanged).toBe(true)
    expect(mockClearCache).toHaveBeenCalledWith('workspace-1')
  })

  it('resets an OAuth server to disconnected when its auth type flips to headers', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        url: 'https://example.com/mcp',
        authType: 'oauth',
        oauthClientId: 'client-1',
        oauthClientSecret: 'secret-1',
      },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        id: 'server-1',
        workspaceId: 'workspace-1',
        name: 'Example',
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        authType: 'headers',
      },
    ])

    const result = await performUpdateMcpServer({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      serverId: 'server-1',
      authType: 'headers',
    })

    expect(result.success).toBe(true)
    // Flipping away from OAuth must reset too — no stale 'connected'/lastError until re-discovery.
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        authType: 'headers',
        connectionStatus: 'disconnected',
        lastConnected: null,
        lastError: null,
      })
    )
    // ...and revoke the now-orphaned OAuth tokens rather than leaving them stored and valid.
    expect(mockRevokeOauthTokens).toHaveBeenCalledWith('server-1', 'workspace-1')
    // The reset columns are the point of this audit row — an auditor needs to see
    // that the connection was invalidated, not just that authType was touched.
    expect(auditUpdatedFields()).toEqual(
      expect.arrayContaining(['authType', 'connectionStatus', 'lastConnected', 'lastError'])
    )
  })

  it('audits only the columns an edit wrote, not the params it was handed', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        url: 'https://example.com/mcp',
        authType: 'headers',
        oauthClientId: null,
        oauthClientSecret: null,
      },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        id: 'server-1',
        workspaceId: 'workspace-1',
        name: 'Renamed',
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        authType: 'headers',
      },
    ])

    // A rename from the settings modal: the route always sends the OAuth params.
    const result = await performUpdateMcpServer({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      serverId: 'server-1',
      name: 'Renamed',
      oauthClientId: null,
      oauthClientIdProvided: false,
      oauthClientSecretProvided: false,
    })

    expect(result.success).toBe(true)
    // `updatedAt` is excluded deliberately — it moves on every write, so it would
    // be noise in every audit row.
    expect(auditUpdatedFields()).toEqual(['name'])
  })

  it('resets to disconnected when a create/upsert flips an existing OAuth server to headers', async () => {
    mockGenerateMcpServerId.mockReturnValue('server-1')
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        deletedAt: null,
        url: 'https://example.com/mcp',
        authType: 'oauth',
        oauthClientId: 'client-1',
        oauthClientSecret: 'secret-1',
      },
    ])
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        workspaceId: 'workspace-1',
        name: 'Example',
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        authType: 'headers',
      },
    ])

    const result = await performCreateMcpServer({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      name: 'Example',
      url: 'https://example.com/mcp',
      authType: 'headers',
    })

    expect(result.success).toBe(true)
    // Upsert must mirror the update path: an auth-type flip resets to disconnected and clears the
    // stale error instead of optimistically marking the server connected.
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        authType: 'headers',
        connectionStatus: 'disconnected',
        lastConnected: null,
        lastError: null,
      })
    )
    // ...and revoke the now-orphaned OAuth tokens.
    expect(mockRevokeOauthTokens).toHaveBeenCalledWith('server-1', 'workspace-1')
  })

  it('audits a re-registration that rewrites a live server as an update', async () => {
    mockGenerateMcpServerId.mockReturnValue('server-1')
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        deletedAt: null,
        url: 'https://example.com/mcp?token=old',
        authType: 'headers',
        oauthClientId: null,
        oauthClientSecret: null,
      },
    ])
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        workspaceId: 'workspace-1',
        name: 'Example',
        transport: 'streamable-http',
        url: 'https://example.com/mcp?token=new',
        authType: 'headers',
      },
    ])

    // The server id hashes origin + pathname only, so a different query string
    // lands on the same row and repoints it.
    const result = await performCreateMcpServer({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      name: 'Example',
      url: 'https://example.com/mcp?token=new',
      headers: { authorization: 'Bearer rotated' },
    })

    expect(result.success).toBe(true)
    expect(result.updated).toBe(true)
    expect(result.revived).toBe(false)
    expect(auditAction()).toBe(AuditAction.MCP_SERVER_UPDATED)
    expect(auditUpdatedFields()).toEqual(expect.arrayContaining(['url', 'headers']))
    // The registration omitted `description`, and Drizzle skips undefined in
    // .set(), so the audit must not claim that column was written.
    expect(auditUpdatedFields()).not.toContain('description')
    // A query string routinely carries the endpoint's token, and audit rows are
    // readable by org admins who need no workspace MCP access.
    expect(auditMetadata()?.url).toBe('https://example.com/mcp')
  })

  it('audits a re-registration that revives a soft-deleted server as an addition', async () => {
    mockGenerateMcpServerId.mockReturnValue('server-1')
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        deletedAt: new Date(),
        url: 'https://example.com/mcp',
        authType: 'headers',
        oauthClientId: null,
        oauthClientSecret: null,
      },
    ])
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        workspaceId: 'workspace-1',
        name: 'Example',
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        authType: 'headers',
      },
    ])

    const result = await performCreateMcpServer({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      name: 'Example',
      url: 'https://example.com/mcp',
    })

    expect(result.success).toBe(true)
    expect(result.revived).toBe(true)
    // Bringing a deleted server back is an addition, so it keeps the ADDED action
    // and carries no updatedFields.
    expect(auditAction()).toBe(AuditAction.MCP_SERVER_ADDED)
    expect(auditUpdatedFields()).toBeUndefined()
  })

  it('evicts the deleted server from the connection pool (row is already gone from clearCache)', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([
      { id: 'server-1', workspaceId: 'workspace-1', name: 'Example', transport: 'streamable-http' },
    ])

    const result = await performDeleteMcpServer({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      serverId: 'server-1',
    })

    expect(result.success).toBe(true)
    expect(mockRevokeOauthTokens).toHaveBeenCalledWith('server-1', 'workspace-1')
    expect(mockEvictServerConnections).toHaveBeenCalledWith('server-1', expect.any(String))
  })
})
