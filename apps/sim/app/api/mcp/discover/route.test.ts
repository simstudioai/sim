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

function workspaceRow(id: string) {
  return {
    workspace: { id, name: `${id} name`, archivedAt: null },
    permissionType: 'write' as const,
  }
}

function serverRow(
  id: string,
  { isPublic = false, workspaceAllowsPersonalApiKeys = true } = {}
): Record<string, unknown> {
  return {
    id,
    name: `${id} name`,
    description: null,
    workspaceId: 'ws-1',
    workspaceName: 'ws-1 name',
    isPublic,
    workspaceAllowsPersonalApiKeys,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    toolCount: 1,
  }
}

function discoverRequest() {
  return new NextRequest('http://localhost:3000/api/mcp/discover', {
    method: 'GET',
    headers: { 'X-API-Key': 'sk_test_123' },
  })
}

function authAs(auth: Record<string, unknown>) {
  hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce({
    success: true,
    userId: 'user-1',
    ...auth,
  })
}

describe('MCP Discover Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockListAccessibleWorkspaceRowsForUser.mockResolvedValue([workspaceRow('ws-1')])
  })

  it('hides private servers whose workspace disallows personal api keys', async () => {
    authAs({ authType: 'api_key', apiKeyType: 'personal' })
    dbChainMockFns.orderBy.mockResolvedValueOnce([
      serverRow('allowed', { workspaceAllowsPersonalApiKeys: true }),
      serverRow('blocked', { workspaceAllowsPersonalApiKeys: false }),
    ])

    const response = await GET(discoverRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.servers.map((server: { id: string }) => server.id)).toEqual(['allowed'])
  })

  it('keeps public servers listed for a personal key even when the workspace disallows them', async () => {
    authAs({ authType: 'api_key', apiKeyType: 'personal' })
    dbChainMockFns.orderBy.mockResolvedValueOnce([
      serverRow('public', { isPublic: true, workspaceAllowsPersonalApiKeys: false }),
      serverRow('private', { isPublic: false, workspaceAllowsPersonalApiKeys: false }),
    ])

    const response = await GET(discoverRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.servers.map((server: { id: string }) => server.id)).toEqual(['public'])
  })

  it('does not filter for a session caller', async () => {
    authAs({ authType: 'session' })
    dbChainMockFns.orderBy.mockResolvedValueOnce([
      serverRow('blocked', { workspaceAllowsPersonalApiKeys: false }),
    ])

    const response = await GET(discoverRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.servers).toHaveLength(1)
  })

  it('does not filter for a workspace key', async () => {
    authAs({ authType: 'api_key', apiKeyType: 'workspace', workspaceId: 'ws-1' })
    dbChainMockFns.orderBy.mockResolvedValueOnce([
      serverRow('blocked', { workspaceAllowsPersonalApiKeys: false }),
    ])

    const response = await GET(discoverRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.servers).toHaveLength(1)
  })
})
