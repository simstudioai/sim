/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { MAX_BILLING_CONCURRENCY_LIMIT } from '@/lib/billing/concurrency-defaults'
import { parseEnterpriseSubscriptionMetadata } from '@/lib/billing/types'

const REQUIRED_METADATA = {
  plan: 'enterprise',
  referenceId: 'org-1',
  monthlyPrice: '500',
  seats: '25',
}

describe('Enterprise subscription metadata', () => {
  it('normalizes the canonical payer concurrency override', () => {
    expect(
      parseEnterpriseSubscriptionMetadata({
        ...REQUIRED_METADATA,
        concurrencyLimit: '1250',
      })
    ).toMatchObject({
      plan: 'enterprise',
      concurrencyLimit: 1250,
    })
  })

  it('rejects concurrency overrides above the operational safety bound', () => {
    expect(
      parseEnterpriseSubscriptionMetadata({
        ...REQUIRED_METADATA,
        concurrencyLimit: MAX_BILLING_CONCURRENCY_LIMIT + 1,
      })
    ).toBeNull()
  })

  it('does not expose the unused workspace-scoped metadata field', () => {
    expect(
      parseEnterpriseSubscriptionMetadata({
        ...REQUIRED_METADATA,
        workspaceConcurrencyLimit: 1250,
      })
    ).toEqual({
      plan: 'enterprise',
      referenceId: 'org-1',
      monthlyPrice: 500,
      seats: 25,
    })
  })
})
