import { describe, expect, it } from 'vitest'
import {
  MAX_BILLING_CONCURRENCY_LIMIT,
  parseBillingConcurrencyLimit,
} from '@/lib/billing/concurrency-defaults'

describe('billing concurrency defaults', () => {
  it('normalizes safe metadata and environment override values', () => {
    expect(parseBillingConcurrencyLimit('1250')).toBe(1250)
    expect(parseBillingConcurrencyLimit(1250)).toBe(1250)
    expect(parseBillingConcurrencyLimit(0)).toBeNull()
    expect(parseBillingConcurrencyLimit(1.5)).toBeNull()
    expect(parseBillingConcurrencyLimit(MAX_BILLING_CONCURRENCY_LIMIT + 1)).toBeNull()
  })
})
