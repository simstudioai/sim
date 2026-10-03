import { describe, expect, it } from 'vitest'
import {
  adminDashboardBalanceGrantBodySchema,
  adminDashboardOrganizationSummarySchema,
  adminDashboardUpdateMemberBodySchema,
} from '@/lib/api/contracts/v1/admin/dashboard'

describe('admin dashboard credit grant contract', () => {
  it('requires a client-stable UUID operation ID', () => {
    expect(
      adminDashboardBalanceGrantBodySchema.safeParse({
        operationId: '67e55044-10b1-426f-9247-bb680e5fe0c8',
        amountDollars: 50,
      }).success
    ).toBe(true)
    expect(adminDashboardBalanceGrantBodySchema.safeParse({ amountDollars: 50 }).success).toBe(
      false
    )
    expect(
      adminDashboardBalanceGrantBodySchema.safeParse({
        operationId: 'retry-1',
        amountDollars: 50,
      }).success
    ).toBe(false)
  })

  it('accepts exact half-cent increments and rejects fractions of a credit', () => {
    const operationId = '67e55044-10b1-426f-9247-bb680e5fe0c8'
    expect(
      adminDashboardBalanceGrantBodySchema.safeParse({ operationId, amountDollars: 0.005 }).success
    ).toBe(true)
    expect(
      adminDashboardBalanceGrantBodySchema.safeParse({ operationId, amountDollars: 0.29 }).success
    ).toBe(true)
    expect(
      adminDashboardBalanceGrantBodySchema.safeParse({ operationId, amountDollars: 0.001 }).success
    ).toBe(false)
  })

  it('preserves valid sub-credit DB residuals in responses and stored member caps', () => {
    expect(
      adminDashboardUpdateMemberBodySchema.safeParse({ usageLimitDollars: 0.001 }).success
    ).toBe(true)
    expect(
      adminDashboardOrganizationSummarySchema.safeParse({
        id: 'org-1',
        name: 'Example',
        owner: null,
        isActive: false,
        subscriptionStatus: null,
        plan: null,
        planLabel: 'No plan',
        memberCount: 0,
        externalCollaboratorCount: 0,
        seats: 0,
        concurrencyLimit: null,
        workflowExecutionTimeoutSeconds: null,
        planAllowanceDollars: null,
        usageLimitDollars: 0.001,
        effectiveUsageLimitDollars: 0.001,
        prepaidBalanceDollars: 0.001,
        invoiceAmountUsd: null,
        billingInterval: null,
        reportingPeriod: {
          anchorDate: null,
          interval: null,
          currentStart: '2026-08-01T00:00:00.000Z',
          currentEnd: '2026-09-01T00:00:00.000Z',
          source: 'default',
        },
        usage: {
          usedDollars: 0.001,
          limitDollars: 0.001,
          usedCredits: 0,
          limitCredits: 0,
          workflowRuns: 0,
        },
        provisioning: null,
      }).success
    ).toBe(true)
  })
})
