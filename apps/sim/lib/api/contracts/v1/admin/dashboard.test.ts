/** @vitest-environment node */

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
        includedMonthlyDollars: 0,
        usageLimitDollars: 0.001,
        effectiveUsageLimitDollars: 0.001,
        prepaidBalanceDollars: 0.001,
        monthlyInvoiceAmountUsd: null,
        provisioning: null,
      }).success
    ).toBe(true)
  })
})
