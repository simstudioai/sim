/**
 * @vitest-environment node
 */
import { createSession, loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbState, mockGetSession, mockHasPaidSubscription } = vi.hoisted(() => ({
  mockDbState: {
    selectResults: [] as any[],
    updateCalls: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  },
  mockGetSession: vi.fn(),
  mockHasPaidSubscription: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn().mockImplementation(() => {
      const chain: any = {}
      chain.from = vi.fn().mockReturnValue(chain)
      chain.where = vi.fn().mockReturnValue(chain)
      chain.then = vi
        .fn()
        .mockImplementation((callback: (rows: any[]) => any) =>
          Promise.resolve(callback(mockDbState.selectResults.shift() ?? []))
        )
      return chain
    }),
    update: vi.fn().mockImplementation((table: unknown) => ({
      set: vi.fn().mockImplementation((values: Record<string, unknown>) => {
        mockDbState.updateCalls.push({ table, values })
        return {
          where: vi.fn().mockResolvedValue(undefined),
        }
      }),
    })),
  },
}))

vi.mock('@sim/db/schema', () => ({
  member: {
    userId: 'member.userId',
    organizationId: 'member.organizationId',
  },
  organization: {
    id: 'organization.id',
  },
  subscription: {
    id: 'subscription.id',
    referenceId: 'subscription.referenceId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
}))

vi.mock('@sim/logger', () => loggerMock)

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/billing', () => ({
  hasPaidSubscription: mockHasPaidSubscription,
}))

vi.mock('@/lib/billing/plan-helpers', () => ({
  isOrgPlan: (plan: string) => plan === 'team' || plan === 'enterprise',
}))

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  hasPaidSubscriptionStatus: (status: string) => status === 'active' || status === 'past_due',
}))

import { POST } from '@/app/api/users/me/subscription/[id]/transfer/route'

describe('POST /api/users/me/subscription/[id]/transfer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbState.selectResults = []
    mockDbState.updateCalls = []
    mockHasPaidSubscription.mockResolvedValue(false)
  })

  it('rejects transfers for non-organization subscriptions', async () => {
    mockGetSession.mockResolvedValue(
      createSession({
        userId: 'user-1',
        email: 'owner@example.com',
        name: 'Owner',
      })
    )
    mockDbState.selectResults = [
      [{ id: 'sub-1', referenceId: 'user-1', plan: 'pro', status: 'active' }],
    ]

    const response = await POST(
      new Request('http://localhost/api/users/me/subscription/sub-1/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: 'org-1' }),
      }) as any,
      { params: Promise.resolve({ id: 'sub-1' }) }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Only active Team or Enterprise subscriptions can be transferred to an organization.',
    })
    expect(mockDbState.updateCalls).toEqual([])
  })

  it('transfers an active organization subscription to an admin-owned organization', async () => {
    mockGetSession.mockResolvedValue(
      createSession({
        userId: 'user-1',
        email: 'owner@example.com',
        name: 'Owner',
      })
    )
    mockDbState.selectResults = [
      [{ id: 'sub-1', referenceId: 'user-1', plan: 'team', status: 'active' }],
      [{ id: 'org-1' }],
      [{ id: 'member-1', role: 'owner' }],
    ]

    const response = await POST(
      new Request('http://localhost/api/users/me/subscription/sub-1/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: 'org-1' }),
      }) as any,
      { params: Promise.resolve({ id: 'sub-1' }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: 'Subscription transferred successfully',
    })
    expect(mockDbState.updateCalls).toEqual([
      {
        table: expect.objectContaining({
          id: 'subscription.id',
          referenceId: 'subscription.referenceId',
        }),
        values: { referenceId: 'org-1' },
      },
    ])
  })

  it('treats an already-transferred organization subscription as a successful no-op', async () => {
    mockGetSession.mockResolvedValue(
      createSession({
        userId: 'user-1',
        email: 'owner@example.com',
        name: 'Owner',
      })
    )
    mockDbState.selectResults = [
      [{ id: 'sub-1', referenceId: 'org-1', plan: 'team', status: 'active' }],
      [{ id: 'org-1' }],
      [{ id: 'member-1', role: 'owner' }],
    ]

    const response = await POST(
      new Request('http://localhost/api/users/me/subscription/sub-1/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: 'org-1' }),
      }) as any,
      { params: Promise.resolve({ id: 'sub-1' }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: 'Subscription already belongs to this organization',
    })
    expect(mockDbState.updateCalls).toEqual([])
    expect(mockHasPaidSubscription).not.toHaveBeenCalled()
  })
})
