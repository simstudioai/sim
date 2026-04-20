/**
 * @vitest-environment node
 */
import {
  authMock,
  authMockFns,
  createSession,
  dbChainMock,
  dbChainMockFns,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@/lib/auth', () => authMock)

vi.mock('@/lib/billing/plan-helpers', () => ({
  isOrgPlan: (plan: string) => plan === 'team' || plan === 'enterprise',
}))

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  ENTITLED_SUBSCRIPTION_STATUSES: ['active', 'past_due'],
  hasPaidSubscriptionStatus: (status: string) => status === 'active' || status === 'past_due',
}))

import { POST } from '@/app/api/users/me/subscription/[id]/transfer/route'

function makeRequest(body: unknown, id = 'sub-1') {
  return POST(
    new Request(`http://localhost/api/users/me/subscription/${id}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as any,
    { params: Promise.resolve({ id }) }
  )
}

describe('POST /api/users/me/subscription/[id]/transfer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue(
      createSession({
        userId: 'user-1',
        email: 'owner@example.com',
        name: 'Owner',
      })
    )
  })

  it('rejects transfers for non-organization subscriptions', async () => {
    dbChainMockFns.for.mockResolvedValueOnce([
      { id: 'sub-1', referenceId: 'user-1', plan: 'pro', status: 'active' },
    ])

    const response = await makeRequest({ organizationId: 'org-1' })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Only active Team or Enterprise subscriptions can be transferred to an organization.',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('transfers an active organization subscription to an admin-owned organization', async () => {
    dbChainMockFns.for
      .mockResolvedValueOnce([
        { id: 'sub-1', referenceId: 'user-1', plan: 'team', status: 'active' },
      ])
      .mockResolvedValueOnce([{ id: 'org-1' }])
    dbChainMockFns.limit.mockResolvedValueOnce([{ role: 'owner' }]).mockResolvedValueOnce([])

    const response = await makeRequest({ organizationId: 'org-1' })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: 'Subscription transferred successfully',
    })
    expect(dbChainMockFns.update).toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ referenceId: 'org-1' })
  })

  it('treats an already-transferred organization subscription as a successful no-op', async () => {
    dbChainMockFns.for
      .mockResolvedValueOnce([
        { id: 'sub-1', referenceId: 'org-1', plan: 'team', status: 'active' },
      ])
      .mockResolvedValueOnce([{ id: 'org-1' }])
    dbChainMockFns.limit.mockResolvedValueOnce([{ role: 'owner' }])

    const response = await makeRequest({ organizationId: 'org-1' })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: 'Subscription already belongs to this organization',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('rejects the noop probe when the requester is not a member of the target organization', async () => {
    dbChainMockFns.for
      .mockResolvedValueOnce([
        { id: 'sub-1', referenceId: 'org-1', plan: 'team', status: 'active' },
      ])
      .mockResolvedValueOnce([{ id: 'org-1' }])
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const response = await makeRequest({ organizationId: 'org-1' })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Unauthorized - user is not admin of organization',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('rejects the transfer when the target organization already has an active subscription', async () => {
    dbChainMockFns.for
      .mockResolvedValueOnce([
        { id: 'sub-1', referenceId: 'user-1', plan: 'team', status: 'active' },
      ])
      .mockResolvedValueOnce([{ id: 'org-1' }])
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ role: 'owner' }])
      .mockResolvedValueOnce([{ id: 'existing-sub' }])

    const response = await makeRequest({ organizationId: 'org-1' })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Organization already has an active subscription',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
