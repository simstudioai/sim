/**
 * Tests for the Managed Agent connections API route — permission gates.
 *
 * @vitest-environment node
 */
import { createMockRequest, permissionsMock, permissionsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckSessionOrInternalAuth, mockListConnections, mockCreateConnection, mockDeleteConnection, mockVerifyAnthropicApiKey } =
  vi.hoisted(() => ({
    mockCheckSessionOrInternalAuth: vi.fn(),
    mockListConnections: vi.fn(),
    mockCreateConnection: vi.fn(),
    mockDeleteConnection: vi.fn(),
    mockVerifyAnthropicApiKey: vi.fn(),
  }))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@/lib/managed-agents/connections', () => ({
  createConnection: mockCreateConnection,
  deleteConnection: mockDeleteConnection,
  listConnections: mockListConnections,
}))

vi.mock('@/lib/managed-agents/anthropic-verify', () => ({
  verifyAnthropicApiKey: mockVerifyAnthropicApiKey,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { DELETE, GET, POST } from '@/app/api/managed-agent-connections/route'

const now = new Date('2026-07-19T00:00:00.000Z')
const connectionRow = {
  id: 'conn_1',
  workspaceId: 'ws_A',
  userId: 'user_1',
  name: 'prod',
  maskedApiKey: 'sk-ant-a…wxyz',
  lastVerifiedAt: now,
  lastVerificationError: null,
  createdAt: now,
  updatedAt: now,
}

describe('GET /api/managed-agent-connections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSessionOrInternalAuth.mockResolvedValue({ success: true, userId: 'user_1' })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')
    mockListConnections.mockResolvedValue([connectionRow])
  })

  it('returns 401 when not authenticated', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValue({ success: false })
    const req = createMockRequest(
      'GET',
      undefined,
      {},
      'http://localhost:3000/api/managed-agent-connections?workspaceId=ws_A'
    )
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 when workspaceId is missing', async () => {
    const req = createMockRequest(
      'GET',
      undefined,
      {},
      'http://localhost:3000/api/managed-agent-connections'
    )
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns 403 when the user has no permission on the workspace', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue(null)
    const req = createMockRequest(
      'GET',
      undefined,
      {},
      'http://localhost:3000/api/managed-agent-connections?workspaceId=ws_A'
    )
    const res = await GET(req)
    expect(res.status).toBe(403)
    expect(mockListConnections).not.toHaveBeenCalled()
  })

  it('allows read-tier members to list', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')
    const req = createMockRequest(
      'GET',
      undefined,
      {},
      'http://localhost:3000/api/managed-agent-connections?workspaceId=ws_A'
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(mockListConnections).toHaveBeenCalledWith({ workspaceId: 'ws_A' })
  })

  it('serializes dates as ISO strings', async () => {
    const req = createMockRequest(
      'GET',
      undefined,
      {},
      'http://localhost:3000/api/managed-agent-connections?workspaceId=ws_A'
    )
    const res = await GET(req)
    const body = await res.json()
    expect(body.data[0].createdAt).toBe(now.toISOString())
    expect(body.data[0].lastVerifiedAt).toBe(now.toISOString())
  })

  it('emits null for lastVerifiedAt when the row has never been verified', async () => {
    mockListConnections.mockResolvedValue([{ ...connectionRow, lastVerifiedAt: null }])
    const req = createMockRequest(
      'GET',
      undefined,
      {},
      'http://localhost:3000/api/managed-agent-connections?workspaceId=ws_A'
    )
    const body = await (await GET(req)).json()
    expect(body.data[0].lastVerifiedAt).toBeNull()
  })
})

describe('POST /api/managed-agent-connections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSessionOrInternalAuth.mockResolvedValue({ success: true, userId: 'user_1' })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
    mockVerifyAnthropicApiKey.mockResolvedValue({ ok: true })
    mockCreateConnection.mockResolvedValue(connectionRow)
  })

  it('returns 401 when not authenticated', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValue({ success: false })
    const req = createMockRequest('POST', {
      workspaceId: 'ws_A',
      name: 'prod',
      apiKey: 'sk-ant-plaintext',
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 403 when the caller only has read permission', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')
    const req = createMockRequest('POST', {
      workspaceId: 'ws_A',
      name: 'prod',
      apiKey: 'sk-ant-plaintext',
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
    expect(mockCreateConnection).not.toHaveBeenCalled()
  })

  it('allows write and admin to create', async () => {
    for (const perm of ['write', 'admin'] as const) {
      permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue(perm)
      mockCreateConnection.mockClear()
      const req = createMockRequest('POST', {
        workspaceId: 'ws_A',
        name: 'prod',
        apiKey: 'sk-ant-plaintext',
      })
      const res = await POST(req)
      expect(res.status).toBe(200)
      expect(mockCreateConnection).toHaveBeenCalledTimes(1)
    }
  })

  it('surfaces the verify error message when createConnection rejects', async () => {
    mockCreateConnection.mockRejectedValue(new Error('Anthropic rejected the key'))
    const req = createMockRequest('POST', {
      workspaceId: 'ws_A',
      name: 'prod',
      apiKey: 'sk-ant-bad',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Anthropic rejected the key')
  })

  it('never returns the plaintext api key in the response', async () => {
    const req = createMockRequest('POST', {
      workspaceId: 'ws_A',
      name: 'prod',
      apiKey: 'sk-ant-plaintext-abcd',
    })
    const res = await POST(req)
    const body = await res.text()
    expect(body).not.toContain('sk-ant-plaintext-abcd')
  })
})

describe('DELETE /api/managed-agent-connections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSessionOrInternalAuth.mockResolvedValue({ success: true, userId: 'user_1' })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
    mockDeleteConnection.mockResolvedValue(true)
  })

  it('returns 401 when not authenticated', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValue({ success: false })
    const req = createMockRequest(
      'DELETE',
      undefined,
      {},
      'http://localhost:3000/api/managed-agent-connections?id=conn_1&workspaceId=ws_A'
    )
    const res = await DELETE(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 when id or workspaceId is missing', async () => {
    const req = createMockRequest(
      'DELETE',
      undefined,
      {},
      'http://localhost:3000/api/managed-agent-connections?workspaceId=ws_A'
    )
    const res = await DELETE(req)
    expect(res.status).toBe(400)
  })

  it('returns 403 when the caller only has read permission', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')
    const req = createMockRequest(
      'DELETE',
      undefined,
      {},
      'http://localhost:3000/api/managed-agent-connections?id=conn_1&workspaceId=ws_A'
    )
    const res = await DELETE(req)
    expect(res.status).toBe(403)
    expect(mockDeleteConnection).not.toHaveBeenCalled()
  })

  it('returns 404 when the connection does not exist for that workspace', async () => {
    mockDeleteConnection.mockResolvedValue(false)
    const req = createMockRequest(
      'DELETE',
      undefined,
      {},
      'http://localhost:3000/api/managed-agent-connections?id=conn_missing&workspaceId=ws_A'
    )
    const res = await DELETE(req)
    expect(res.status).toBe(404)
  })

  it('allows write and admin to delete', async () => {
    for (const perm of ['write', 'admin'] as const) {
      permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue(perm)
      mockDeleteConnection.mockClear().mockResolvedValue(true)
      const req = createMockRequest(
        'DELETE',
        undefined,
        {},
        'http://localhost:3000/api/managed-agent-connections?id=conn_1&workspaceId=ws_A'
      )
      const res = await DELETE(req)
      expect(res.status).toBe(200)
      expect(mockDeleteConnection).toHaveBeenCalledWith({ id: 'conn_1', workspaceId: 'ws_A' })
    }
  })
})
