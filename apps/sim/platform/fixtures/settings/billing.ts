import { toRecord } from '@sim/utils/object'
import type { SettingsFixtureState } from '@/platform/fixtures/settings/state'

const LIMIT = 'billing/usage-limit'
const CANCELLATION = 'billing/cancel-at-period-end'

export function fixtureSeats(state: SettingsFixtureState) {
  return state.plan === 'free' ? 0 : state.scenario === 'stress' ? 178 : 10
}

export function setSubscriptionCancellation(state: SettingsFixtureState, cancelled: boolean) {
  state.records.set(CANCELLATION, cancelled)
}

export async function billingFixture(request: Request, path: string, state: SettingsFixtureState) {
  const { plan } = state
  const paid = plan !== 'free'
  const included = plan === 'team' ? 100 : 0
  const currentLimit = state.records.get(LIMIT) ?? included
  if (path === `/api/organizations/${state.organizationId}/billing-summary`) {
    return {
      success: true,
      data: {
        organizationId: state.organizationId,
        subscriptionState: paid ? 'active' : 'free',
        subscriptionPlan: plan,
        subscriptionStatus: paid ? 'active' : null,
        creditBalance: 0,
        billingInterval: state.scenario === 'stress' ? 'year' : 'month',
        cancelAtPeriodEnd: state.records.get(CANCELLATION) === true,
        totalSeats: fixtureSeats(state),
        totalCurrentUsage: paid ? 12 : 0,
        totalUsageLimit: currentLimit,
        minimumBillingAmount: included,
        billingPeriodEnd: paid ? '2026-11-01T00:00:00Z' : null,
        billingBlocked: false,
        billingBlockedReason: null,
        blockedByOrgOwner: false,
        upgradeWorkspaceId: null,
        userRole: 'owner',
      },
    }
  }
  if (path === '/api/usage') {
    if (request.method === 'PUT') {
      const { limit } = toRecord(await request.json())
      if (typeof limit === 'number') state.records.set(LIMIT, limit)
    }
    return {
      success: true,
      context: 'organization',
      userId: state.general.profile.id,
      organizationId: state.organizationId,
      data:
        request.method === 'PUT'
          ? null
          : {
              currentLimit: state.records.get(LIMIT) ?? included,
              canEdit: true,
              minimumLimit: included,
              plan,
              updatedAt: null,
              scope: 'organization',
              organizationId: state.organizationId,
            },
    }
  }
  if (path === '/api/billing/invoices') {
    const monthCount = !paid || state.scenario === 'empty' ? 0 : state.scenario === 'stress' ? 6 : 1
    return {
      success: true,
      hasMore: monthCount === 6,
      invoices: Array.from({ length: monthCount }, (_, i) => ({
        id: `invoice-${i}`,
        number: `SIM-${101 - i}`,
        created: Date.UTC(2026, 9 - i, 1) / 1000,
        total: 5000,
        amountPaid: 5000,
        currency: 'usd',
        status: 'paid',
        description: 'Organization subscription',
        hostedInvoiceUrl: null,
        invoicePdf: null,
      })),
    }
  }
}
