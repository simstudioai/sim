import type { Principal } from '@sim/auth/principal'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { billingCoreMock, billingCoreMockFns } from '@sim/testing/mocks/billing-core.mock'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'

const hoisted = vi.hoisted(() => ({
  summary: vi.fn(),
  breakdown: vi.fn(),
  workspace: vi.fn(),
}))

vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)
vi.mock('@/lib/billing/core/billing', () => billingCoreMock)
vi.mock('@/lib/billing/core/organization-activity-queries', () => ({
  readActivityDays: hoisted.summary,
  readActivityBreakdown: hoisted.breakdown,
  readActivityWorkspace: hoisted.workspace,
}))

import {
  getOrganizationActivityBreakdown,
  getOrganizationActivitySummary,
} from '@/lib/billing/application/organization-usage/get-organization-activity'

const mocks = {
  ...hoisted,
  subscription: billingCoreMockFns.mockGetOrganizationSubscription,
  authority: organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation,
  entitlement: billingSubscriptionMockFns.mockIsOrganizationFeatureEntitled,
}

const principal = createSessionPrincipal({ userId: 'admin', sessionId: 'session' })
const input = {
  organizationId: 'org',
  preset: 'custom' as const,
  timezone: 'America/Los_Angeles',
  startDate: new Date('2026-03-08'),
  endDate: new Date('2026-03-09'),
  workspaceId: 'workspace',
}
const breakdownInput = {
  ...input,
  dimension: 'workflow' as const,
  sort: 'failures' as const,
  page: 2,
}

beforeEach(() => {
  mocks.authority.mockResolvedValue(true)
  mocks.entitlement.mockResolvedValue(true)
  mocks.subscription.mockResolvedValue(null)
  mocks.workspace.mockResolvedValue({ id: 'workspace', name: 'Support' })
  mocks.summary.mockResolvedValue(new Map())
  mocks.breakdown.mockResolvedValue({ rows: [], hasMore: false })
})

describe.each([
  [
    'summary',
    (actor: Principal) => getOrganizationActivitySummary.execute({ principal: actor, input }),
  ],
  [
    'breakdown',
    (actor: Principal) =>
      getOrganizationActivityBreakdown.execute({ principal: actor, input: breakdownInput }),
  ],
] as const)('organization activity %s authorization', (_name, run) => {
  it('rejects API keys before loading organization data', async () => {
    await expect(
      run(createPersonalApiKeyPrincipal({ userId: 'admin', keyId: 'key' }))
    ).rejects.toMatchObject({ detailCode: 'PRINCIPAL_KIND_NOT_PERMITTED' })
    expect(mocks.authority).not.toHaveBeenCalled()
    expect(mocks.workspace).not.toHaveBeenCalled()
  })

  it('requires current organization admin authority before checking entitlement or reading activity', async () => {
    mocks.authority.mockRejectedValue(
      new ForbiddenOperationError('ORGANIZATION_ADMIN_REQUIRED', 'Admin required')
    )
    await expect(run(principal)).rejects.toMatchObject({
      detailCode: 'ORGANIZATION_ADMIN_REQUIRED',
    })
    expect(mocks.authority).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({
        minimumRole: 'admin',
        principalKinds: ['session', 'organization_delegated'],
      }),
      { organizationId: 'org' }
    )
    expect(mocks.entitlement).not.toHaveBeenCalled()
    expect(mocks.workspace).not.toHaveBeenCalled()
    expect(mocks.summary).not.toHaveBeenCalled()
    expect(mocks.breakdown).not.toHaveBeenCalled()
  })

  it('enforces the enterprise or self-hosted entitlement', async () => {
    mocks.entitlement.mockResolvedValue(false)
    await expect(run(principal)).rejects.toMatchObject({ detailCode: 'ENTERPRISE_PLAN_REQUIRED' })
    expect(mocks.workspace).not.toHaveBeenCalled()
  })

  it('rejects a foreign or deleted workspace before any activity aggregation', async () => {
    mocks.workspace.mockResolvedValue(null)
    await expect(run(principal)).rejects.toThrow('Workspace not found')
    expect(mocks.workspace).toHaveBeenCalledWith('org', 'workspace')
    expect(mocks.summary).not.toHaveBeenCalled()
    expect(mocks.breakdown).not.toHaveBeenCalled()
  })
})

describe('activity summary folding', () => {
  const day = (overrides: Record<string, unknown> = {}) => ({
    workflowRuns: 0,
    completed: 0,
    failed: 0,
    durationSum: 0,
    durationCount: 0,
    chatRuns: 0,
    chatMembers: [],
    ...overrides,
  })
  const run = () => getOrganizationActivitySummary.execute({ principal, input })

  it('counts a chat member active on two days once', async () => {
    mocks.summary.mockResolvedValue(
      new Map([
        ['2026-03-08', day({ chatRuns: 2, chatMembers: ['a'] })],
        ['2026-03-09', day({ chatRuns: 4, chatMembers: ['a', 'b'] })],
      ])
    )
    const summary = await run()
    expect(summary.totals).toMatchObject({ chatRuns: 6, chatMembers: 2 })
    expect(summary.series.map((point) => point.chatRuns)).toEqual([2, 4])
  })

  it('weights the mean duration by runs, not by days', async () => {
    mocks.summary.mockResolvedValue(
      new Map([
        [
          '2026-03-08',
          day({ workflowRuns: 3, completed: 2, failed: 1, durationSum: 300, durationCount: 3 }),
        ],
        ['2026-03-09', day({ workflowRuns: 1, completed: 1, durationSum: 700, durationCount: 1 })],
      ])
    )
    expect((await run()).totals).toMatchObject({
      workflowRuns: 4,
      failureRate: 0.25,
      averageDurationMs: 250,
    })
  })
})
