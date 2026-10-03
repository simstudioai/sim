import { db } from '@sim/db'
import { member } from '@sim/db/schema'
import {
  auditMock,
  authMockFns,
  createMockRequest,
  createSession,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  setEnvFlags,
} from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { billingCoreMock, billingCoreMockFns } from '@sim/testing/mocks/billing-core.mock'
import {
  organizationMemberLimitsMock,
  organizationMemberLimitsMockFns,
} from '@sim/testing/mocks/organization-member-limits.mock'
import { permissionGroupsResolveMock } from '@sim/testing/mocks/permission-groups-resolve.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/billing/organizations/member-limits', () => organizationMemberLimitsMock)

vi.mock('@/lib/billing/core/billing', () => billingCoreMock)

import { GET, PUT } from '@/app/api/organizations/[id]/members/[memberId]/usage-limit/route'

const {
  mockGetOrgMemberUsageForCurrentPeriod,
  mockGetOrgMemberUsageLimit,
  mockSetOrgMemberUsageLimit,
  mockIsOrgMemberUsageLimitTarget,
} = organizationMemberLimitsMockFns
const { mockGetOrganizationSubscription } = billingCoreMockFns

const mockGetSession = authMockFns.mockGetSession

afterAll(resetEnvFlagsMock)

function context() {
  return createRouteContext({ id: 'org-1', memberId: 'user-2' })
}

function putRequest(body: unknown) {
  return createMockRequest('PUT', body)
}

function getRequest() {
  return createMockRequest('GET')
}

describe('GET /api/organizations/[id]/members/[memberId]/usage-limit', () => {
  beforeEach(() => {
    setEnvFlags({ isHosted: true })
    mockGetSession.mockResolvedValue({
      ...createSession({ userId: 'admin-1' }),
      session: { id: 'session-1' },
    })
    resetDbChainMock()
    queueTableRows(member, [{ role: 'admin' }])
    mockIsOrgMemberUsageLimitTarget.mockResolvedValue(true)
    mockGetOrgMemberUsageForCurrentPeriod.mockResolvedValue(1) // $1 -> 200 credits
    mockGetOrgMemberUsageLimit.mockResolvedValue(2) // $2 -> 400 credits
    mockGetOrganizationSubscription.mockResolvedValue(null)
  })

  it('returns 403 for non-admin callers', async () => {
    resetDbChainMock()
    queueTableRows(member, [{ role: 'member' }])
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
    expect(mockGetOrgMemberUsageForCurrentPeriod).toHaveBeenCalledWith('org-1', 'user-2', null)
    expect(mockIsOrgMemberUsageLimitTarget).toHaveBeenCalledWith('org-1', 'user-2')
  })

  it('returns 404 before reading a target outside the organization', async () => {
    mockIsOrgMemberUsageLimitTarget.mockResolvedValue(false)
    const res = await GET(getRequest(), context())
    expect(res.status).toBe(404)
    expect(mockGetOrgMemberUsageLimit).not.toHaveBeenCalled()
    expect(mockGetOrganizationSubscription).not.toHaveBeenCalled()
    expect(mockGetOrgMemberUsageForCurrentPeriod).not.toHaveBeenCalled()
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
    setEnvFlags({ isHosted: true })
    mockGetSession.mockResolvedValue({
      ...createSession({ userId: 'admin-1' }),
      session: { id: 'session-1' },
    })
    resetDbChainMock()
    queueTableRows(member, [{ role: 'admin' }])
    mockIsOrgMemberUsageLimitTarget.mockResolvedValue(true)
    mockSetOrgMemberUsageLimit.mockResolvedValue(undefined)
  })

  it('returns 403 for non-admin callers', async () => {
    resetDbChainMock()
    queueTableRows(member, [{ role: 'member' }])
    const res = await PUT(putRequest({ creditLimit: 400 }), context())
    expect(res.status).toBe(403)
    expect(mockSetOrgMemberUsageLimit).not.toHaveBeenCalled()
  })

  it('persists the limit as dollars (credits / 200) and audits', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    const res = await PUT(putRequest({ creditLimit: 400 }), context())
    expect(res.status).toBe(200)
    expect(mockSetOrgMemberUsageLimit).toHaveBeenCalledWith('org-1', 'user-2', 2, 'admin-1', db)
    expect(auditMock.recordAudit).toHaveBeenCalledTimes(1)
    await expect(res.json()).resolves.toEqual({
      success: true,
      message: 'Member credit limit updated successfully',
      data: { creditLimit: 400 },
    })
  })

  it('clears the cap when creditLimit is null', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    const res = await PUT(putRequest({ creditLimit: null }), context())
    expect(res.status).toBe(200)
    expect(mockSetOrgMemberUsageLimit).toHaveBeenCalledWith('org-1', 'user-2', null, 'admin-1', db)
  })

  it.each([400, null])(
    'rejects cap %s for a target outside the organization',
    async (creditLimit) => {
      mockIsOrgMemberUsageLimitTarget.mockResolvedValue(false)
      const res = await PUT(putRequest({ creditLimit }), context())
      expect(res.status).toBe(404)
      expect(mockSetOrgMemberUsageLimit).not.toHaveBeenCalled()
      expect(auditMock.recordAudit).not.toHaveBeenCalled()
    }
  )
})
