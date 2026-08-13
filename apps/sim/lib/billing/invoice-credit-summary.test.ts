/**
 * @vitest-environment node
 */
import type Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import {
  attachInvoiceCreditSummary,
  creditPurchaseSummary,
  mergeInvoiceCreditCustomFields,
  periodUsageCreditSummary,
  usageChargeCreditSummary,
} from '@/lib/billing/invoice-credit-summary'

describe('invoice credit summaries', () => {
  it('labels purchased credits without treating them as usage', () => {
    const summary = creditPurchaseSummary(10)

    expect(summary).toEqual({ type: 'credit_purchase', creditsPurchased: 2000 })
    expect(mergeInvoiceCreditCustomFields({ summary, existingCustomFields: null })).toEqual([
      { name: 'Credits purchased', value: '2,000' },
    ])
  })

  it('apportions usage charges so the displayed components reconcile', () => {
    const summary = usageChargeCreditSummary({
      prepaidCreditsAppliedDollars: 0.006,
      billedDollars: 0.009,
    })

    expect(summary).toEqual({
      type: 'usage_charge',
      creditsUsed: 3,
      prepaidCreditsApplied: 1,
      creditsBilled: 2,
    })
    expect(summary.prepaidCreditsApplied + summary.creditsBilled).toBe(summary.creditsUsed)
  })

  it('uses a summary-specific idempotency key when updating a draft invoice', async () => {
    const summary = periodUsageCreditSummary(21.175)
    const update = vi.fn().mockResolvedValue({ id: 'in-1' })
    const stripe = { invoices: { update } } as unknown as Stripe

    await attachInvoiceCreditSummary({
      stripe,
      invoice: {
        custom_fields: [],
        id: 'in-1',
        status: 'draft',
      } as Stripe.Invoice,
      summary,
    })

    expect(update).toHaveBeenCalledWith(
      'in-1',
      { custom_fields: [{ name: 'Credits used', value: '4,235' }] },
      { idempotencyKey: 'invoice-credit-summary:in-1:period_usage:4235' }
    )
  })

  it('does not block billing when Stripe cannot apply the optional presentation', async () => {
    const stripe = {
      invoices: { retrieve: vi.fn().mockRejectedValue(new Error('Stripe unavailable')) },
    } as unknown as Stripe

    await expect(
      attachInvoiceCreditSummary({
        stripe,
        invoice: 'in-1',
        summary: periodUsageCreditSummary(5),
      })
    ).resolves.toEqual({ status: 'failed' })
  })

  it('preserves existing custom fields when capacity remains', () => {
    const customFields = mergeInvoiceCreditCustomFields({
      summary: periodUsageCreditSummary(5),
      existingCustomFields: [{ name: 'PO number', value: 'PO-123' }],
    })

    expect(customFields).toEqual([
      { name: 'PO number', value: 'PO-123' },
      { name: 'Credits used', value: '1,000' },
    ])
  })

  it('reports that no custom field slot is available without overwriting customer data', () => {
    const existingCustomFields = [
      { name: 'Field 1', value: 'one' },
      { name: 'Field 2', value: 'two' },
      { name: 'Field 3', value: 'three' },
      { name: 'Field 4', value: 'four' },
    ]
    const customFields = mergeInvoiceCreditCustomFields({
      summary: periodUsageCreditSummary(5),
      existingCustomFields,
    })

    expect(customFields).toBeNull()
  })
})
