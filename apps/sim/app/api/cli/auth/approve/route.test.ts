/**
 * @vitest-environment node
 */
import { createHash } from 'node:crypto'
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockCreateApproval, mockEnforceUserRateLimit, mockGetPermissions } =
  vi.hoisted(() => ({
    mockGetSession: vi.fn(),
    mockCreateApproval: vi.fn(),
    mockEnforceUserRateLimit: vi.fn(),
    mockGetPermissions: vi.fn(),
  }))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/lib/cli-auth/approval-store', () => ({
  createApproval: mockCreateApproval,
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  enforceUserRateLimit: mockEnforceUserRateLimit,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetPermissions,
}))

import { POST } from '@/app/api/cli/auth/approve/route'

const REQUEST = 'a'.repeat(43)
const CHALLENGE = createHash('sha256').update('b'.repeat(43)).digest('base64url')

describe('POST /api/cli/auth/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockEnforceUserRateLimit.mockResolvedValue(null)
    mockCreateApproval.mockResolvedValue(undefined)
    mockGetPermissions.mockResolvedValue('admin')
  })

  it('records the approval for the signed-in user', async () => {
    const response = await POST(
      createMockRequest('POST', { request: REQUEST, challenge: CHALLENGE })
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mockCreateApproval).toHaveBeenCalledWith('user-1', REQUEST, CHALLENGE, {
      scope: 'copilot',
      workspaceId: undefined,
      workspaceBound: false,
    })
  })

  it('defaults to the copilot scope so pre-scope terminals keep working', async () => {
    await POST(createMockRequest('POST', { request: REQUEST, challenge: CHALLENGE }))
    expect(mockCreateApproval).toHaveBeenCalledWith(
      'user-1',
      REQUEST,
      CHALLENGE,
      expect.objectContaining({ scope: 'copilot' })
    )
  })

  it('records a workspace binding when the approver is a workspace admin', async () => {
    const response = await POST(
      createMockRequest('POST', {
        request: REQUEST,
        challenge: CHALLENGE,
        scope: 'platform',
        workspaceId: 'ws-1',
        bindKeyToWorkspace: true,
      })
    )
    expect(response.status).toBe(200)
    expect(mockCreateApproval).toHaveBeenCalledWith('user-1', REQUEST, CHALLENGE, {
      scope: 'platform',
      workspaceId: 'ws-1',
      workspaceBound: true,
    })
  })

  it("records a non-admin's pick as a default without binding the key to it", async () => {
    mockGetPermissions.mockResolvedValue('write')
    const response = await POST(
      createMockRequest('POST', {
        request: REQUEST,
        challenge: CHALLENGE,
        scope: 'platform',
        workspaceId: 'ws-1',
      })
    )
    expect(response.status).toBe(200)
    expect(mockCreateApproval).toHaveBeenCalledWith('user-1', REQUEST, CHALLENGE, {
      scope: 'platform',
      workspaceId: 'ws-1',
      workspaceBound: false,
    })
  })

  it('refuses to bind a key to a workspace the approver is not admin of', async () => {
    mockGetPermissions.mockResolvedValue('write')
    const response = await POST(
      createMockRequest('POST', {
        request: REQUEST,
        challenge: CHALLENGE,
        scope: 'platform',
        workspaceId: 'ws-1',
        bindKeyToWorkspace: true,
      })
    )
    expect(response.status).toBe(403)
    expect(mockCreateApproval).not.toHaveBeenCalled()
  })

  it('refuses a workspace the approver is not a member of', async () => {
    mockGetPermissions.mockResolvedValue(null)
    const response = await POST(
      createMockRequest('POST', {
        request: REQUEST,
        challenge: CHALLENGE,
        scope: 'platform',
        workspaceId: 'ws-1',
      })
    )
    expect(response.status).toBe(404)
    expect(mockCreateApproval).not.toHaveBeenCalled()
  })

  it('refuses bindKeyToWorkspace with no workspaceId', async () => {
    const response = await POST(
      createMockRequest('POST', {
        request: REQUEST,
        challenge: CHALLENGE,
        scope: 'platform',
        bindKeyToWorkspace: true,
      })
    )
    expect(response.status).toBe(400)
    expect(mockCreateApproval).not.toHaveBeenCalled()
  })

  it('refuses a workspace binding on the copilot scope', async () => {
    const response = await POST(
      createMockRequest('POST', {
        request: REQUEST,
        challenge: CHALLENGE,
        scope: 'copilot',
        workspaceId: 'ws-1',
      })
    )
    expect(response.status).toBe(400)
    expect(mockCreateApproval).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller', async () => {
    mockGetSession.mockResolvedValue(null)
    const response = await POST(
      createMockRequest('POST', { request: REQUEST, challenge: CHALLENGE })
    )
    expect(response.status).toBe(401)
    expect(mockCreateApproval).not.toHaveBeenCalled()
  })

  it('ignores a user id supplied in the body', async () => {
    await POST(
      createMockRequest('POST', { request: REQUEST, challenge: CHALLENGE, userId: 'attacker' })
    )
    expect(mockCreateApproval).toHaveBeenCalledWith('user-1', REQUEST, CHALLENGE, expect.anything())
  })

  it('rejects a malformed challenge', async () => {
    const response = await POST(
      createMockRequest('POST', { request: REQUEST, challenge: 'not-a-digest' })
    )
    expect(response.status).toBe(400)
    expect(mockCreateApproval).not.toHaveBeenCalled()
  })
})
