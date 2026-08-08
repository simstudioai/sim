/**
 * @vitest-environment node
 */
import { dbChainMockFns, hybridAuthMockFns, resetDbChainMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListAccessibleWorkspaceRowsForUser } = vi.hoisted(() => ({
  mockListAccessibleWorkspaceRowsForUser: vi.fn(),
}))

vi.mock('@/lib/workspaces/utils', () => ({
  listAccessibleWorkspaceRowsForUser: mockListAccessibleWorkspaceRowsForUser,
}))

import { GET } from '@/app/api/mcp/discover/route'

function workspaceRow(id: string, allowPersonalApiKeys: boolean) {
  return {
    workspace: { id, name: `${id} name`, allowPersonalApiKeys, archivedAt: null },
    permissionType: 'write' as const,
  }
}

function discoverRequest() {
  return new NextRequest('http://localhost:3000/api/mcp/discover', {
    method: 'GET',
    headers: { 'X-API-Key': 'sk_test_123' },
  })
}

describe('MCP Discover Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockListAccessibleWorkspaceRowsForUser.mockResolvedValue([
      workspaceRow('ws-allowed', true),
      workspaceRow('ws-blocked', false),
    ])
  })

  it('hides servers in workspaces that disallow personal api keys', async () => {
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-1',
      authType: 'api_key',
      apiKeyType: 'personal',
    })
    dbChainMockFns.orderBy.mockResolvedValueOnce([
      { id: 'server-1', name: 'Allowed', workspaceId: 'ws-allowed', toolCount: 1 },
    ])

    const response = await GET(discoverRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.servers).toHaveLength(1)
    expect(body.servers[0].workspace.id).toBe('ws-allowed')
  })

  it('returns no servers when a personal key has only blocked workspaces', async () => {
    mockListAccessibleWorkspaceRowsForUser.mockResolvedValue([workspaceRow('ws-blocked', false)])
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-1',
      authType: 'api_key',
      apiKeyType: 'personal',
    })

    const response = await GET(discoverRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.servers).toEqual([])
    expect(dbChainMockFns.orderBy).not.toHaveBeenCalled()
  })

  it('does not filter workspaces for a session caller', async () => {
    mockListAccessibleWorkspaceRowsForUser.mockResolvedValue([workspaceRow('ws-blocked', false)])
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    dbChainMockFns.orderBy.mockResolvedValueOnce([
      { id: 'server-1', name: 'Blocked workspace server', workspaceId: 'ws-blocked', toolCount: 0 },
    ])

    const response = await GET(discoverRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.servers).toHaveLength(1)
  })

  it('does not filter workspaces for a workspace key', async () => {
    mockListAccessibleWorkspaceRowsForUser.mockResolvedValue([workspaceRow('ws-blocked', false)])
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-1',
      authType: 'api_key',
      apiKeyType: 'workspace',
      workspaceId: 'ws-blocked',
    })
    dbChainMockFns.orderBy.mockResolvedValueOnce([
      { id: 'server-1', name: 'Blocked workspace server', workspaceId: 'ws-blocked', toolCount: 0 },
    ])

    const response = await GET(discoverRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.servers).toHaveLength(1)
  })
})
