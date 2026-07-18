/**
 * @vitest-environment node
 */
import {
  auditMock,
  dbChainMock,
  dbChainMockFns,
  drizzleOrmMock,
  encryptionMock,
  loggerMock,
  posthogServerMock,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockClearCache, mockOauthCredsChanged } = vi.hoisted(() => ({
  mockClearCache: vi.fn(),
  mockOauthCredsChanged: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/db', () => ({
  ...dbChainMock,
  mcpServers: schemaMock.mcpServers,
}))
vi.mock('@sim/db/schema', () => ({
  mcpServerOauth: schemaMock.mcpServerOauth,
}))
vi.mock('@sim/logger', () => loggerMock)
vi.mock('@sim/utils/id', () => ({ generateId: vi.fn() }))
vi.mock('drizzle-orm', () => drizzleOrmMock)
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
  revokeMcpOauthTokens: vi.fn(),
}))
vi.mock('@/lib/mcp/service', () => ({
  mcpService: { clearCache: mockClearCache },
}))
vi.mock('@/lib/mcp/utils', () => ({ generateMcpServerId: vi.fn() }))
vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { performUpdateMcpServer } from '@/lib/mcp/orchestration/server-lifecycle'

describe('MCP server lifecycle orchestration', () => {
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
    expect(mockClearCache).toHaveBeenCalledWith('workspace-1')
  })
})
