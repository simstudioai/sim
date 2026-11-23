import { describe, expect, it } from 'vitest'
import type {
  AccountBillingDecision,
  BillingAttributionSnapshot,
} from '@/lib/billing/core/attribution'
import { isCappedRunPayer } from '@/lib/billing/core/mid-run-usage'

const decision: AccountBillingDecision = {
  userId: 'user-1',
  billingEntity: { type: 'user', id: 'user-1' },
  billingPeriod: { start: '2026-07-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' },
}

function attributed(plan: string | null, status = 'active'): BillingAttributionSnapshot {
  return {
    payerSubscription: plan
      ? {
          id: 'sub-1',
          referenceId: 'user-1',
          plan,
          status,
          seats: null,
          periodStart: null,
          periodEnd: null,
        }
      : null,
  } as BillingAttributionSnapshot
}

describe('isCappedRunPayer', () => {
  it.each([
    { label: 'a free payer', payer: attributed(null), capped: true },
    { label: 'a trial', payer: attributed('pro_6000', 'trialing'), capped: true },
    { label: 'a paid plan', payer: attributed('pro_6000'), capped: false },
  ])('judges $label on an attributed run', ({ payer, capped }) => {
    expect(isCappedRunPayer(payer)).toBe(capped)
  })

  it.each([
    {
      label: 'a trial recorded at admission, despite its subscription',
      payer: { ...decision, payerSubscriptionId: 'sub-1', payerBillsOverage: false },
      capped: true,
    },
    {
      label: 'a paid plan recorded at admission',
      payer: { ...decision, payerSubscriptionId: 'sub-1', payerBillsOverage: true },
      capped: false,
    },
    {
      label: 'an older decision with a subscription',
      payer: { ...decision, payerSubscriptionId: 'sub-1' },
      capped: false,
    },
    { label: 'an older decision without one', payer: decision, capped: true },
  ])('judges $label on a direct-v1 run', ({ payer, capped }) => {
    expect(isCappedRunPayer(payer)).toBe(capped)
  })
})
