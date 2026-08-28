/**
 * @vitest-environment node
 */
import type { PersonalApiKeyPrincipal, SessionPrincipal } from '@sim/auth/principal'
import { setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canUserManageBillingEntity: vi.fn(),
  isOrganizationFeatureEntitled: vi.fn(),
  getOrganizationSubscription: vi.fn(),
  readUsageTotals: vi.fn(),
  readUsageTimeSeries: vi.fn(),
}))

vi.mock('@/lib/billing/core/workspace-billing-authority', () => ({
  canUserManageBillingEntity: mocks.canUserManageBillingEntity,
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationFeatureEntitled: mocks.isOrganizationFeatureEntitled,
}))
vi.mock('@/lib/billing/core/billing', () => ({
  getOrganizationSubscription: mocks.getOrganizationSubscription,
}))
vi.mock('@/lib/billing/core/usage-analytics-queries', () => ({
  readUsageTotals: mocks.readUsageTotals,
  readUsageTimeSeries: mocks.readUsageTimeSeries,
  readUsageBreakdown: vi.fn(),
  readUsageEntityNames: vi.fn(),
}))

import { getOrganizationUsageSummary } from '@/lib/billing/application/organization-usage/get-organization-usage-summary'
import { ForbiddenOperationError } from '@/lib/core/application'

const ORG = 'org-1'
const session: SessionPrincipal = { kind: 'session', userId: 'admin-1', sessionId: 'session-1' }
const personalKey: PersonalApiKeyPrincipal = {
  kind: 'personal_api_key',
  userId: 'admin-1',
  keyId: 'key-1',
}

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
    vi.clearAllMocks()
    setEnvFlags({ isBillingEnabled: true, isHosted: true })
    mocks.canUserManageBillingEntity.mockResolvedValue(true)
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

  it('refuses an API key: pooled usage discloses every member’s spend', async () => {
    // The operation names `session` alone. Widening it is a deliberate decision, not
    // something that should fall out of a principal shape happening to carry a userId.
    expect(await codeOf(run(personalKey))).toBe('PRINCIPAL_KIND_NOT_PERMITTED')
    expect(mocks.canUserManageBillingEntity).not.toHaveBeenCalled()
  })

  it('refuses a member who is not an organization admin', async () => {
    mocks.canUserManageBillingEntity.mockResolvedValue(false)

    expect(await codeOf(run())).toBe('ORGANIZATION_ADMIN_REQUIRED')
  })

  it('refuses an organization without the entitlement', async () => {
    mocks.isOrganizationFeatureEntitled.mockResolvedValue(false)

    expect(await codeOf(run())).toBe('ENTERPRISE_PLAN_REQUIRED')
  })

  it('checks authority before entitlement, so a non-admin learns nothing about the plan', async () => {
    mocks.canUserManageBillingEntity.mockResolvedValue(false)
    mocks.isOrganizationFeatureEntitled.mockResolvedValue(false)

    expect(await codeOf(run())).toBe('ORGANIZATION_ADMIN_REQUIRED')
    expect(mocks.isOrganizationFeatureEntitled).not.toHaveBeenCalled()
  })

  it('asks the entitlement helper, not the plan directly, so self-hosted stays gated', async () => {
    // `isOrganizationOnEnterprisePlan` answers true for every organization once billing
    // is off, which would hand the feature to every self-hosted deployment.
    await run()

    expect(mocks.isOrganizationFeatureEntitled).toHaveBeenCalledWith(ORG, expect.any(Boolean))
  })

  it('scopes the read to the caller’s organization and resolves its period once', async () => {
    await run()

    expect(mocks.getOrganizationSubscription).toHaveBeenCalledTimes(1)
    // Both reads share one scope built from one resolved period, which is what keeps the
    // totals and the chart describing the same rows.
    const [totalsScope] = mocks.readUsageTotals.mock.calls[0]
    const [seriesScope] = mocks.readUsageTimeSeries.mock.calls[0]
    expect(JSON.stringify(totalsScope)).toContain(ORG)
    expect(JSON.stringify(seriesScope)).toBe(JSON.stringify(totalsScope))
  })
})
