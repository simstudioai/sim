/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BILLING_CONCURRENCY_LIMITS,
  MAX_BILLING_CONCURRENCY_LIMIT,
  parseBillingConcurrencyLimit,
} from '@/lib/billing/concurrency-defaults'

describe('billing concurrency defaults', () => {
  it('keeps the hosted plan progression explicit', () => {
    expect(DEFAULT_BILLING_CONCURRENCY_LIMITS).toEqual({
      free: 10,
      pro: 50,
      team: 200,
      enterprise: 1000,
    })
  })

  it('normalizes safe metadata and environment override values', () => {
    expect(parseBillingConcurrencyLimit('1250')).toBe(1250)
    expect(parseBillingConcurrencyLimit(1250)).toBe(1250)
    expect(parseBillingConcurrencyLimit(0)).toBeNull()
    expect(parseBillingConcurrencyLimit(1.5)).toBeNull()
    expect(parseBillingConcurrencyLimit(MAX_BILLING_CONCURRENCY_LIMIT + 1)).toBeNull()
  })
})
