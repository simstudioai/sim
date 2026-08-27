/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import {
  adminDashboardBalanceGrantBodySchema,
  adminDashboardEnterprisePreflightQuerySchema,
  adminDashboardEnterprisePreflightSchema,
  adminDashboardIssueEnterpriseBodySchema,
  adminDashboardLimitsBodySchema,
  adminDashboardMemberPreflightQuerySchema,
  adminDashboardMemberPreflightSchema,
  adminDashboardOrganizationDetailQuerySchema,
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

  it('accepts positive integer Enterprise concurrency limits', () => {
    expect(adminDashboardLimitsBodySchema.safeParse({ concurrencyLimit: 1250 }).success).toBe(true)
    expect(
      adminDashboardIssueEnterpriseBodySchema.safeParse({
        ownerUserId: 'owner-1',
        invoiceAmountUsd: 500,
        seats: 10,
        concurrencyLimit: 1250,
        pausePaymentCollection: true,
      }).success
    ).toBe(true)
    expect(adminDashboardLimitsBodySchema.safeParse({ concurrencyLimit: 0 }).success).toBe(false)
    expect(adminDashboardLimitsBodySchema.safeParse({ concurrencyLimit: 1.5 }).success).toBe(false)
  })

  it('defaults Enterprise issuance to annual while accepting an explicit monthly cadence', () => {
    const annual = adminDashboardIssueEnterpriseBodySchema.parse({
      ownerUserId: 'owner-1',
      invoiceAmountUsd: 1_200,
      seats: 10,
    })
    const monthly = adminDashboardIssueEnterpriseBodySchema.parse({
      ownerUserId: 'owner-1',
      invoiceAmountUsd: 100,
      billingInterval: 'month',
      seats: 10,
    })

    expect(annual.billingInterval).toBe('year')
    expect(monthly.billingInterval).toBe('month')
  })

  it('rejects the removed monthly-named invoice field', () => {
    expect(
      adminDashboardIssueEnterpriseBodySchema.safeParse({
        ownerUserId: 'owner-1',
        monthlyInvoiceAmountUsd: 100,
        seats: 10,
      }).success
    ).toBe(false)
  })

  it('paginates Enterprise workspace preflight without hiding the total inventory', () => {
    expect(adminDashboardEnterprisePreflightQuerySchema.parse({ ownerUserId: 'owner-1' })).toEqual({
      ownerUserId: 'owner-1',
      search: '',
      limit: 50,
      offset: 0,
    })
    expect(
      adminDashboardEnterprisePreflightSchema.safeParse({
        owner: { id: 'owner-1', name: 'Owner', email: 'owner@example.com' },
        organization: null,
        personalWorkspaces: [{ id: 'workspace-1', name: 'One', archived: false }],
        workspacePagination: { total: 51, limit: 50, offset: 0, hasMore: true },
        workspaceSelection: {
          totalEligible: 51,
          defaultSelectedIds: Array.from({ length: 51 }, (_, index) => `workspace-${index + 1}`),
          defaultSelectedWorkspaces: Array.from({ length: 51 }, (_, index) => ({
            id: `workspace-${index + 1}`,
            name: `Workspace ${index + 1}`,
            archived: false,
          })),
          includesAllEligible: true,
          limit: 1_000,
        },
        billingPreview: null,
        canIssue: true,
        reason: null,
      }).success
    ).toBe(true)
  })

  it('paginates member-transfer workspaces and makes over-limit defaults explicit', () => {
    expect(adminDashboardMemberPreflightQuerySchema.parse({ userId: 'user-1' })).toEqual({
      userId: 'user-1',
      search: '',
      limit: 50,
      offset: 0,
    })
    expect(
      adminDashboardMemberPreflightSchema.safeParse({
        user: { id: 'user-1', name: 'User', email: 'user@example.com' },
        currentOrganization: null,
        personalWorkspaces: [{ id: 'workspace-1', name: 'One', archived: false }],
        workspacePagination: { total: 1_205, limit: 50, offset: 0, hasMore: true },
        workspaceSelection: {
          totalEligible: 1_205,
          defaultSelectedIds: [],
          defaultSelectedWorkspaces: [],
          includesAllEligible: false,
          limit: 1_000,
        },
        credentialDependencies: [],
        canAdd: true,
        reason: null,
      }).success
    ).toBe(true)
  })

  it('keeps organization detail unbounded for legacy callers and supports bounded collection pages', () => {
    expect(adminDashboardOrganizationDetailQuerySchema.parse({})).toEqual({
      limit: 50,
      memberOffset: 0,
      externalCollaboratorOffset: 0,
      workspaceOffset: 0,
    })
    expect(
      adminDashboardOrganizationDetailQuerySchema.parse({
        limit: '25',
        memberOffset: '50',
        externalCollaboratorOffset: '75',
        workspaceOffset: '100',
      })
    ).toEqual({
      limit: 25,
      memberOffset: 50,
      externalCollaboratorOffset: 75,
      workspaceOffset: 100,
    })
  })

  it('does not expose included allowance as an editable organization control', () => {
    expect(adminDashboardLimitsBodySchema.safeParse({ includedMonthlyDollars: 100 }).success).toBe(
      false
    )
  })

  it('accepts null to restore the deployment-wide Enterprise concurrency default', () => {
    expect(adminDashboardLimitsBodySchema.safeParse({ concurrencyLimit: null }).success).toBe(true)
    expect(
      adminDashboardIssueEnterpriseBodySchema.safeParse({
        ownerUserId: 'owner-1',
        invoiceAmountUsd: 500,
        seats: 10,
        concurrencyLimit: null,
      }).success
    ).toBe(false)
  })
})
