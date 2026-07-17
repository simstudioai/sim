/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import {
  adminDashboardBalanceGrantBodySchema,
  adminDashboardIssueEnterpriseBodySchema,
  adminDashboardLimitsBodySchema,
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
        includedMonthlyDollars: 0,
        usageLimitDollars: 0.001,
        effectiveUsageLimitDollars: 0.001,
        prepaidBalanceDollars: 0.001,
        monthlyInvoiceAmountUsd: null,
        provisioning: null,
      }).success
    ).toBe(true)
  })

  it('accepts positive integer Enterprise concurrency limits', () => {
    expect(adminDashboardLimitsBodySchema.safeParse({ concurrencyLimit: 1250 }).success).toBe(true)
    expect(
      adminDashboardIssueEnterpriseBodySchema.safeParse({
        ownerUserId: 'owner-1',
        monthlyInvoiceAmountUsd: 500,
        seats: 10,
        concurrencyLimit: 1250,
        pausePaymentCollection: true,
      }).success
    ).toBe(true)
    expect(adminDashboardLimitsBodySchema.safeParse({ concurrencyLimit: 0 }).success).toBe(false)
    expect(adminDashboardLimitsBodySchema.safeParse({ concurrencyLimit: 1.5 }).success).toBe(false)
  })

  it('accepts null to restore the deployment-wide Enterprise concurrency default', () => {
    expect(adminDashboardLimitsBodySchema.safeParse({ concurrencyLimit: null }).success).toBe(true)
    expect(
      adminDashboardIssueEnterpriseBodySchema.safeParse({
        ownerUserId: 'owner-1',
        monthlyInvoiceAmountUsd: 500,
        seats: 10,
        concurrencyLimit: null,
      }).success
    ).toBe(false)
  })
})
