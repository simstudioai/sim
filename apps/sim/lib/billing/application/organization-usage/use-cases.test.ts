import type { PersonalApiKeyPrincipal, SessionPrincipal } from '@sim/auth/principal'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { billingCoreMock, billingCoreMockFns } from '@sim/testing/mocks/billing-core.mock'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import { setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  readUsageTotals: vi.fn(),
  readUsageTimeSeries: vi.fn(),
}))

vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)
vi.mock('@/lib/billing/core/billing', () => billingCoreMock)
vi.mock('@/lib/billing/core/usage-analytics-queries', () => ({
  readUsageTotals: hoisted.readUsageTotals,
  readUsageTimeSeries: hoisted.readUsageTimeSeries,
  readUsageBreakdown: vi.fn(),
  readUsageEntities: vi.fn(),
}))

import { getOrganizationUsageSummary } from '@/lib/billing/application/organization-usage/get-organization-usage-summary'
import { ForbiddenOperationError } from '@/lib/core/application'

const ORG = 'org-1'
const mocks = {
  ...hoisted,
  getOrganizationSubscription: billingCoreMockFns.mockGetOrganizationSubscription,
  authorizeOrganizationOperation:
    organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation,
  isOrganizationFeatureEntitled: billingSubscriptionMockFns.mockIsOrganizationFeatureEntitled,
}

const session = createSessionPrincipal({ userId: 'admin-1' })

const input = {
  organizationId: ORG,
  preset: 'current-period' as const,
  timezone: 'UTC',
}

function run(principal: SessionPrincipal | PersonalApiKeyPrincipal = session) {
  return getOrganizationUsageSummary.execute({ principal, input })
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    throw new Error('expected the use case to refuse')
  } catch (error) {
    expect(error).toBeInstanceOf(ForbiddenOperationError)
    return (error as ForbiddenOperationError).detailCode
  }
}

describe('organization usage authorization', () => {
  beforeEach(() => {
    setEnvFlags({ isBillingEnabled: true, isHosted: true })
    mocks.authorizeOrganizationOperation.mockResolvedValue(true)
    mocks.isOrganizationFeatureEntitled.mockResolvedValue(true)
    mocks.getOrganizationSubscription.mockResolvedValue({
      plan: 'enterprise',
      periodStart: new Date('2026-08-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-01T00:00:00.000Z'),
    })
    mocks.readUsageTotals.mockResolvedValue({ cost: 1 })
    mocks.readUsageTimeSeries.mockResolvedValue([])
  })

  afterAll(() => {
    setEnvFlags({ isBillingEnabled: false, isHosted: false })
  })

  it('refuses a member who is not an organization admin', async () => {
    mocks.authorizeOrganizationOperation.mockRejectedValue(
      new ForbiddenOperationError('ORGANIZATION_ADMIN_REQUIRED', 'Admin required')
    )

    expect(await codeOf(run())).toBe('ORGANIZATION_ADMIN_REQUIRED')
  })

  it('refuses an organization without the entitlement', async () => {
    mocks.isOrganizationFeatureEntitled.mockResolvedValue(false)

    expect(await codeOf(run())).toBe('ENTERPRISE_PLAN_REQUIRED')
  })

  it('checks authority before entitlement, so a non-admin learns nothing about the plan', async () => {
    mocks.authorizeOrganizationOperation.mockRejectedValue(
      new ForbiddenOperationError('ORGANIZATION_ADMIN_REQUIRED', 'Admin required')
    )
    mocks.isOrganizationFeatureEntitled.mockResolvedValue(false)

    expect(await codeOf(run())).toBe('ORGANIZATION_ADMIN_REQUIRED')
    expect(mocks.isOrganizationFeatureEntitled).not.toHaveBeenCalled()
  })

  it('narrows the drill-down’s chart and its comparison window to the same workspace', async () => {
    /*
      A reporting period, so the delta's read actually happens: `resolvePreviousPeriod`
      returns null for a stripe period, and against the default subscription above this
      test would assert the narrowing of a query that was never issued.
    */
    mocks.getOrganizationSubscription.mockResolvedValue({
      plan: 'enterprise',
      metadata: { reportingPeriodAnchorDate: '2026-01-01', reportingPeriodInterval: 'month' },
    })

    await getOrganizationUsageSummary.execute({
      principal: session,
      input: { ...input, workspaceId: 'ws-1' },
    })

    // The current window and the previous one, both narrowed. Narrowing only the
    // current window measures one workspace against the whole organization and
    // renders the difference as that workspace's own trend.
    expect(mocks.readUsageTotals).toHaveBeenCalledTimes(2)
    for (const [scope] of mocks.readUsageTotals.mock.calls) {
      expect(JSON.stringify(scope)).toContain('ws-1')
    }
    expect(JSON.stringify(mocks.readUsageTimeSeries.mock.calls[0][0])).toContain('ws-1')
  })
})
