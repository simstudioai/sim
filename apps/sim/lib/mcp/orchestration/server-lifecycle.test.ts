import {
  auditMock,
  auditMockFns,
  dbChainMockFns,
  encryptionMock,
  posthogServerMock,
  resetDbChainMock,
} from '@sim/testing'
import { idMock } from '@sim/testing/mocks/id.mock'
import { mcpOauthMock, mcpOauthMockFns } from '@sim/testing/mocks/mcp-oauth.mock'
import { mcpServiceMock, mcpServiceMockFns } from '@sim/testing/mocks/mcp-service.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGenerateMcpServerId } = vi.hoisted(() => ({
  mockGenerateMcpServerId: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/utils/id', () => idMock)
vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/mcp/domain-check', () => ({
  MCP_EGRESS_PROFILE: 'selfHostedService',
  OAUTH_EGRESS_PROFILE: 'contentFetch',
  McpDnsResolutionError: class extends Error {},
  McpDomainNotAllowedError: class extends Error {},
  McpSsrfError: class extends Error {},
  validateMcpDomain: vi.fn(),
  validateMcpServerSsrf: vi.fn(),
}))
vi.mock('@/lib/mcp/oauth', () => mcpOauthMock)
vi.mock('@/lib/mcp/service', () => mcpServiceMock)
vi.mock('@/lib/mcp/utils', () => ({ generateMcpServerId: mockGenerateMcpServerId }))
vi.mock('@/lib/posthog/server', () => posthogServerMock)

import {
  performCreateMcpServer,
  performUpdateMcpServer,
} from '@/lib/mcp/orchestration/server-lifecycle'

const mockClearCache = mcpServiceMockFns.mockClearCache
const mockEvictServerConnections = mcpServiceMockFns.mockEvictServerConnections
const mockOauthCredsChanged = mcpOauthMockFns.mockOauthCredsChanged
const mockRevokeOauthTokens = mcpOauthMockFns.mockRevokeMcpOauthTokens

describe('MCP server lifecycle orchestration', () => {
  const auditUpdatedFields = (): string[] | undefined =>
    auditMockFns.mockRecordAudit.mock.calls.at(-1)?.[0].metadata.updatedFields
  const auditAction = (): string | undefined =>
    auditMockFns.mockRecordAudit.mock.calls.at(-1)?.[0].action
  const auditMetadata = (): Record<string, unknown> | undefined =>
    auditMockFns.mockRecordAudit.mock.calls.at(-1)?.[0].metadata

  beforeEach(() => {
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

  it('resets the connection when a headers server rotates the headers that authenticate it', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        url: 'https://example.com/mcp',
        authType: 'headers',
        headers: { authorization: 'Bearer original' },
        oauthClientId: null,
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
        authType: 'headers',
      },
    ])

    const result = await performUpdateMcpServer({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      serverId: 'server-1',
      headers: { authorization: 'Bearer rotated' },
    })

    expect(result.success).toBe(true)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { authorization: 'Bearer rotated' },
        connectionStatus: 'disconnected',
        lastConnected: null,
        lastError: null,
      })
    )
    // Rotating headers invalidates nothing OAuth holds, so the grant survives.
    expect(mockRevokeOauthTokens).not.toHaveBeenCalled()
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

  it('registers a new server as disconnected rather than stamping a connection it never made', async () => {
    mockGenerateMcpServerId.mockReturnValue('server-1')
    dbChainMockFns.limit.mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        workspaceId: 'workspace-1',
        name: 'Example',
        transport: 'streamable-http',
        url: 'https://example.com/anything',
        authType: 'headers',
      },
    ])

    const result = await performCreateMcpServer({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      name: 'Example',
      url: 'https://example.com/anything',
      headers: { authorization: 'Bearer token' },
    })

    expect(result.success).toBe(true)
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({ connectionStatus: 'disconnected', lastConnected: null })
    )
  })

  it('keeps an explicit auth type when an OAuth client ID is also supplied', async () => {
    mockGenerateMcpServerId.mockReturnValue('server-1')
    dbChainMockFns.limit.mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        workspaceId: 'workspace-1',
        name: 'Example',
        transport: 'streamable-http',
        url: 'https://example.com/anything',
        authType: 'headers',
      },
    ])

    const result = await performCreateMcpServer({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      name: 'Example',
      url: 'https://example.com/anything',
      authType: 'headers',
      oauthClientId: 'client-1',
      oauthClientIdProvided: true,
    })

    expect(result.success).toBe(true)
    expect(result.authType).toBe('headers')
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({ authType: 'headers', oauthClientId: 'client-1' })
    )
  })

  it('leaves a re-registered server disconnected until discovery re-runs', async () => {
    mockGenerateMcpServerId.mockReturnValue('server-1')
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        deletedAt: null,
        url: 'https://example.com/mcp',
        transport: 'streamable-http',
        headers: { authorization: 'Bearer original' },
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
      headers: { authorization: 'Bearer rotated' },
    })

    expect(result.success).toBe(true)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionStatus: 'disconnected',
        lastConnected: null,
        lastError: null,
      })
    )
  })

  /**
   * `isServerEligibleForDiscovery` skips an OAuth row that is not `connected`,
   * and only a real discovery can set `connected`. Clearing the status for an
   * edit that changes nothing a connection is made from therefore removes every
   * tool the server publishes, with no path back.
   */
  it('keeps an OAuth server connected through a re-registration that only renames it', async () => {
    mockGenerateMcpServerId.mockReturnValue('server-1')
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        deletedAt: null,
        url: 'https://example.com/mcp',
        transport: 'streamable-http',
        headers: {},
        authType: 'oauth',
        oauthClientId: 'client-1',
        oauthClientSecret: 'secret-1',
      },
    ])
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        workspaceId: 'workspace-1',
        name: 'Renamed',
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        authType: 'oauth',
      },
    ])

    const result = await performCreateMcpServer({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      name: 'Renamed',
      description: 'Now with a description',
      url: 'https://example.com/mcp',
    })

    expect(result.success).toBe(true)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Renamed', description: 'Now with a description' })
    )
    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ connectionStatus: 'disconnected' })
    )
    expect(result.updatedFields).not.toContain('connectionStatus')
    // A rename invalidates nothing, so the stored OAuth grant must survive it too.
    expect(mockRevokeOauthTokens).not.toHaveBeenCalled()
  })

  it('resets a re-registered server whose transport changes', async () => {
    mockGenerateMcpServerId.mockReturnValue('server-1')
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        deletedAt: null,
        url: 'https://example.com/mcp',
        transport: 'streamable-http',
        headers: {},
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
        transport: 'sse',
        url: 'https://example.com/mcp',
        authType: 'oauth',
      },
    ])

    const result = await performCreateMcpServer({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      name: 'Example',
      url: 'https://example.com/mcp',
      transport: 'sse',
    })

    expect(result.success).toBe(true)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionStatus: 'disconnected',
        lastConnected: null,
        lastError: null,
      })
    )
  })
})
