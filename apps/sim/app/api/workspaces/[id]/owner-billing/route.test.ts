/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockGetUserEntityPermissions, mockGetWorkspaceOwnerSubscriptionAccess } =
  vi.hoisted(() => ({
    mockGetSession: vi.fn(),
    mockGetUserEntityPermissions: vi.fn(),
    mockGetWorkspaceOwnerSubscriptionAccess: vi.fn(),
  }))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/lib/billing/core/workspace-access', () => ({
  getWorkspaceOwnerSubscriptionAccess: mockGetWorkspaceOwnerSubscriptionAccess,
}))

import { GET } from '@/app/api/workspaces/[id]/owner-billing/route'

const WORKSPACE_ID = 'ws-1'

const PAID_ACCESS = {
  plan: 'team_25000',
  status: 'active',
  isPaid: true,
  isPro: false,
  isTeam: true,
  isEnterprise: false,
  isOrgScoped: true,
  organizationId: 'org-1',
}

function buildParams() {
  return { params: Promise.resolve({ id: WORKSPACE_ID }) }
}

async function callGet() {
  const request = createMockRequest('GET')
  const response = await GET(request, buildParams())
  return { status: response.status, body: await response.json() }
}

describe('GET /api/workspaces/[id]/owner-billing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'u-1' } })
    mockGetUserEntityPermissions.mockResolvedValue('read')
    mockGetWorkspaceOwnerSubscriptionAccess.mockResolvedValue(PAID_ACCESS)
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null)
    const { status } = await callGet()
    expect(status).toBe(401)
    expect(mockGetWorkspaceOwnerSubscriptionAccess).not.toHaveBeenCalled()
  })

  it('returns 404 when the caller has no workspace access', async () => {
    mockGetUserEntityPermissions.mockResolvedValue(null)
    const { status } = await callGet()
    expect(status).toBe(404)
    expect(mockGetWorkspaceOwnerSubscriptionAccess).not.toHaveBeenCalled()
  })

  it('returns the workspace owner subscription access for a member', async () => {
    const { status, body } = await callGet()
    expect(status).toBe(200)
    expect(body).toEqual(PAID_ACCESS)
    expect(mockGetWorkspaceOwnerSubscriptionAccess).toHaveBeenCalledWith(WORKSPACE_ID)
  })
})
