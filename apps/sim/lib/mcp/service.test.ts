/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  MockMcpClient,
  mockListTools,
  mockConnect,
  mockDisconnect,
  mockGetWorkspaceServersRows,
  mockResolveEnvVars,
  mockValidateDomain,
  mockValidateSsrf,
  mockIsDomainAllowed,
} = vi.hoisted(() => {
  const mockListTools = vi.fn()
  const mockConnect = vi.fn()
  const mockDisconnect = vi.fn()
  return {
    MockMcpClient: vi.fn().mockImplementation(() => ({
      connect: mockConnect,
      disconnect: mockDisconnect,
      listTools: mockListTools,
      hasListChangedCapability: vi.fn(() => false),
      onClose: vi.fn(),
      getNegotiatedVersion: vi.fn(() => '2025-06-18'),
    })),
    mockListTools,
    mockConnect,
    mockDisconnect,
    mockGetWorkspaceServersRows: vi.fn(),
    mockResolveEnvVars: vi.fn(),
    mockValidateDomain: vi.fn(),
    mockValidateSsrf: vi.fn(),
    mockIsDomainAllowed: vi.fn(() => true),
  }
})

vi.mock('@sim/db', () => {
  const setter = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
  return {
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: (...args: unknown[]) => mockGetWorkspaceServersRows(...args),
        }),
      }),
      update: vi.fn().mockReturnValue({ set: setter }),
      insert: vi.fn(),
      delete: vi.fn(),
    },
  }
})

vi.mock('@/lib/mcp/client', () => ({
  McpClient: MockMcpClient,
}))

vi.mock('@/lib/mcp/connection-manager', () => ({
  mcpConnectionManager: null,
}))

vi.mock('@/lib/mcp/domain-check', () => ({
  isMcpDomainAllowed: (...args: unknown[]) => mockIsDomainAllowed(...args),
  validateMcpDomain: (...args: unknown[]) => mockValidateDomain(...args),
  validateMcpServerSsrf: (...args: unknown[]) => mockValidateSsrf(...args),
}))

vi.mock('@/lib/mcp/oauth', () => ({
  getOrCreateOauthRow: vi.fn(),
  loadPreregisteredClient: vi.fn(),
  SimMcpOauthProvider: vi.fn(),
  withMcpOauthRefreshLock: vi.fn(),
}))

vi.mock('@/lib/mcp/resolve-config', () => ({
  resolveMcpConfigEnvVars: (...args: unknown[]) => mockResolveEnvVars(...args),
}))

import { mcpService } from '@/lib/mcp/service'
import { McpOauthAuthorizationRequiredError } from '@/lib/mcp/types'

const WORKSPACE_ID = 'workspace-test'
const USER_ID = 'user-test'

function dbRow(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name,
    description: null,
    transport: 'streamable-http',
    url: `https://${id}.example.com/mcp`,
    authType: 'headers',
    workspaceId: WORKSPACE_ID,
    headers: {},
    timeout: 30000,
    retries: 3,
    enabled: true,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

function tool(name: string, serverId: string) {
  return {
    name,
    description: name,
    inputSchema: { type: 'object' },
    serverId,
    serverName: serverId,
  }
}

describe('McpService.discoverTools per-server caching', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockIsDomainAllowed.mockReturnValue(true)
    mockValidateSsrf.mockResolvedValue('1.2.3.4')
    mockValidateDomain.mockImplementation(() => undefined)
    mockResolveEnvVars.mockImplementation((config: { url: string }) =>
      Promise.resolve({ config: { ...config, url: config.url }, missingVars: [] })
    )
    mockConnect.mockResolvedValue(undefined)
    mockDisconnect.mockResolvedValue(undefined)
    // The McpService singleton holds cache state across imports.
    await mcpService.clearCache()
  })

  it('caches each server independently after first discovery', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A'), dbRow('mcp-b', 'B')])
    mockListTools
      .mockResolvedValueOnce([tool('a1', 'mcp-a')])
      .mockResolvedValueOnce([tool('b1', 'mcp-b')])

    const first = await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(first.map((t) => t.name).sort()).toEqual(['a1', 'b1'])
    expect(mockListTools).toHaveBeenCalledTimes(2)

    mockListTools.mockClear()
    const second = await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(second.map((t) => t.name).sort()).toEqual(['a1', 'b1'])
    expect(mockListTools).not.toHaveBeenCalled()
  })

  it("one server failing does not poison another server's cache", async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A'), dbRow('mcp-b', 'B')])
    mockListTools
      .mockResolvedValueOnce([tool('a1', 'mcp-a')])
      .mockRejectedValueOnce(new Error('Request timed out'))

    const first = await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(first.map((t) => t.name)).toEqual(['a1'])

    mockListTools.mockClear()
    mockListTools.mockResolvedValueOnce([tool('b1', 'mcp-b')])

    const second = await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(second.map((t) => t.name).sort()).toEqual(['a1', 'b1'])
    expect(mockListTools).toHaveBeenCalledTimes(1)
  })

  it("forceRefresh bypasses every server's cache", async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A'), dbRow('mcp-b', 'B')])
    mockListTools
      .mockResolvedValueOnce([tool('a1', 'mcp-a')])
      .mockResolvedValueOnce([tool('b1', 'mcp-b')])

    await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(mockListTools).toHaveBeenCalledTimes(2)

    mockListTools.mockClear()
    mockListTools
      .mockResolvedValueOnce([tool('a2', 'mcp-a')])
      .mockResolvedValueOnce([tool('b2', 'mcp-b')])

    const refreshed = await mcpService.discoverTools(USER_ID, WORKSPACE_ID, true)
    expect(refreshed.map((t) => t.name).sort()).toEqual(['a2', 'b2'])
    expect(mockListTools).toHaveBeenCalledTimes(2)
  })

  it('OAuth-pending is treated as a soft skip without poisoning cache', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A'), dbRow('mcp-b', 'B')])
    mockListTools
      .mockResolvedValueOnce([tool('a1', 'mcp-a')])
      .mockRejectedValueOnce(new McpOauthAuthorizationRequiredError('mcp-b', 'B'))

    const first = await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(first.map((t) => t.name)).toEqual(['a1'])

    mockListTools.mockClear()
    mockListTools.mockRejectedValueOnce(new McpOauthAuthorizationRequiredError('mcp-b', 'B'))

    await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(mockListTools).toHaveBeenCalledTimes(1)
  })

  it('returns empty array immediately when workspace has no servers', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([])

    const result = await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(result).toEqual([])
    expect(mockListTools).not.toHaveBeenCalled()
    expect(MockMcpClient).not.toHaveBeenCalled()
  })

  it('clearCache(workspaceId) drops cached tools so next call re-fetches', async () => {
    mockGetWorkspaceServersRows.mockResolvedValue([dbRow('mcp-a', 'A')])
    mockListTools.mockResolvedValueOnce([tool('a1', 'mcp-a')])

    await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(mockListTools).toHaveBeenCalledTimes(1)

    await mcpService.clearCache(WORKSPACE_ID)

    mockListTools.mockClear()
    mockListTools.mockResolvedValueOnce([tool('a1', 'mcp-a')])
    await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    expect(mockListTools).toHaveBeenCalledTimes(1)
  })

  it('isolates caches across workspaces', async () => {
    const otherWorkspaceId = 'workspace-other'
    mockGetWorkspaceServersRows
      .mockResolvedValueOnce([dbRow('mcp-a', 'A')])
      .mockResolvedValueOnce([dbRow('mcp-a', 'A', { workspaceId: otherWorkspaceId })])

    mockListTools
      .mockResolvedValueOnce([tool('a1', 'mcp-a')])
      .mockResolvedValueOnce([tool('a-other', 'mcp-a')])

    const first = await mcpService.discoverTools(USER_ID, WORKSPACE_ID)
    const second = await mcpService.discoverTools(USER_ID, otherWorkspaceId)

    expect(first.map((t) => t.name)).toEqual(['a1'])
    expect(second.map((t) => t.name)).toEqual(['a-other'])
    expect(mockListTools).toHaveBeenCalledTimes(2)
  })
})
