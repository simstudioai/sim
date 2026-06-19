/**
 * @vitest-environment node
 */
import { auditMock, createMockRequest, createSession } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockIsOrganizationOwnerOrAdmin,
  mockGetOrgMemberUsageLimit,
  mockGetOrgMemberWorkspaceUsage,
  mockSetOrgMemberUsageLimit,
  mockGetOrganizationSubscription,
  mockFlags,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockIsOrganizationOwnerOrAdmin: vi.fn(),
  mockGetOrgMemberUsageLimit: vi.fn(),
  mockGetOrgMemberWorkspaceUsage: vi.fn(),
  mockSetOrgMemberUsageLimit: vi.fn(),
  mockGetOrganizationSubscription: vi.fn(),
  mockFlags: { isHosted: true },
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/billing/core/organization', () => ({
  isOrganizationOwnerOrAdmin: mockIsOrganizationOwnerOrAdmin,
}))

vi.mock('@/lib/billing/organizations/member-limits', () => ({
  getOrgMemberUsageLimit: mockGetOrgMemberUsageLimit,
  getOrgMemberWorkspaceUsage: mockGetOrgMemberWorkspaceUsage,
  setOrgMemberUsageLimit: mockSetOrgMemberUsageLimit,
}))

vi.mock('@/lib/billing/core/billing', () => ({
  getOrganizationSubscription: mockGetOrganizationSubscription,
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isHosted() {
    return mockFlags.isHosted
  },
}))

import { GET, PUT } from '@/app/api/organizations/[id]/members/[memberId]/usage-limit/route'

function context() {
  return { params: Promise.resolve({ id: 'org-1', memberId: 'user-2' }) }
}

function putRequest(body: unknown) {
  return createMockRequest('PUT', body)
}

function getRequest() {
  return createMockRequest('GET')
}

describe('GET /api/organizations/[id]/members/[memberId]/usage-limit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlags.isHosted = true
    mockGetSession.mockResolvedValue(createSession({ userId: 'admin-1' }))
    mockIsOrganizationOwnerOrAdmin.mockResolvedValue(true)
    mockGetOrgMemberWorkspaceUsage.mockResolvedValue(1) // $1 -> 200 credits
    mockGetOrgMemberUsageLimit.mockResolvedValue(2) // $2 -> 400 credits
    mockGetOrganizationSubscription.mockResolvedValue(null)
  })

  it('returns 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await GET(getRequest(), context())
    expect(res.status).toBe(401)
  })

  it('returns 404 when not hosted', async () => {
    mockFlags.isHosted = false
    const res = await GET(getRequest(), context())
    expect(res.status).toBe(404)
  })

  it('returns 403 for non-admin callers', async () => {
    mockIsOrganizationOwnerOrAdmin.mockResolvedValue(false)
    const res = await GET(getRequest(), context())
    expect(res.status).toBe(403)
  })

  it('returns credits used and limit converted to credits', async () => {
    const res = await GET(getRequest(), context())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      success: true,
      data: {
        creditsUsed: 200,
        creditLimit: 400,
        billingInterval: 'month',
      },
    })
  })

  it('returns null creditLimit when no cap is set', async () => {
    mockGetOrgMemberUsageLimit.mockResolvedValue(null)
    const res = await GET(getRequest(), context())
    const body = await res.json()
    expect(body.data.creditLimit).toBeNull()
  })

  it('reports a yearly billing interval from subscription metadata', async () => {
    mockGetOrganizationSubscription.mockResolvedValue({ metadata: { billingInterval: 'year' } })
    const res = await GET(getRequest(), context())
    const body = await res.json()
    expect(body.data.billingInterval).toBe('year')
  })

  it('prefers the billing_interval column when metadata lacks it', async () => {
    mockGetOrganizationSubscription.mockResolvedValue({ billingInterval: 'year', metadata: {} })
    const res = await GET(getRequest(), context())
    const body = await res.json()
    expect(body.data.billingInterval).toBe('year')
  })
})

describe('PUT /api/organizations/[id]/members/[memberId]/usage-limit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlags.isHosted = true
    mockGetSession.mockResolvedValue(createSession({ userId: 'admin-1' }))
    mockIsOrganizationOwnerOrAdmin.mockResolvedValue(true)
    mockSetOrgMemberUsageLimit.mockResolvedValue(undefined)
  })

  it('returns 404 when not hosted', async () => {
    mockFlags.isHosted = false
    const res = await PUT(putRequest({ creditLimit: 400 }), context())
    expect(res.status).toBe(404)
    expect(mockSetOrgMemberUsageLimit).not.toHaveBeenCalled()
  })

  it('returns 403 for non-admin callers', async () => {
    mockIsOrganizationOwnerOrAdmin.mockResolvedValue(false)
    const res = await PUT(putRequest({ creditLimit: 400 }), context())
    expect(res.status).toBe(403)
    expect(mockSetOrgMemberUsageLimit).not.toHaveBeenCalled()
  })

  it('persists the limit as dollars (credits / 200) and audits', async () => {
    const res = await PUT(putRequest({ creditLimit: 400 }), context())
    expect(res.status).toBe(200)
    expect(mockSetOrgMemberUsageLimit).toHaveBeenCalledWith('org-1', 'user-2', 2, 'admin-1')
    expect(auditMock.recordAudit).toHaveBeenCalledTimes(1)
    await expect(res.json()).resolves.toEqual({
      success: true,
      message: 'Member credit limit updated successfully',
      data: { creditLimit: 400 },
    })
  })

  it('clears the cap when creditLimit is null', async () => {
    const res = await PUT(putRequest({ creditLimit: null }), context())
    expect(res.status).toBe(200)
    expect(mockSetOrgMemberUsageLimit).toHaveBeenCalledWith('org-1', 'user-2', null, 'admin-1')
  })

  it('rejects a negative credit limit with 400', async () => {
    const res = await PUT(putRequest({ creditLimit: -5 }), context())
    expect(res.status).toBe(400)
    expect(mockSetOrgMemberUsageLimit).not.toHaveBeenCalled()
  })
})
