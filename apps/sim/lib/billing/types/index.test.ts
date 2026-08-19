/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { MAX_BILLING_CONCURRENCY_LIMIT } from '@/lib/billing/concurrency-defaults'
import { MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS } from '@/lib/billing/execution-timeout-defaults'
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

  it('normalizes the workflow execution timeout in seconds', () => {
    expect(
      parseEnterpriseSubscriptionMetadata({
        ...REQUIRED_METADATA,
        workflowExecutionTimeoutSeconds: '86400',
      })
    ).toMatchObject({ workflowExecutionTimeoutSeconds: 86_400 })
  })

  it('ignores workflow execution timeouts above seven days', () => {
    expect(
      parseEnterpriseSubscriptionMetadata({
        ...REQUIRED_METADATA,
        workflowExecutionTimeoutSeconds: MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS + 1,
      })
    ).toEqual({
      plan: 'enterprise',
      referenceId: 'org-1',
      monthlyPrice: 500,
      invoiceAmountUsd: 500,
      seats: 25,
    })
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
      invoiceAmountUsd: 500,
      seats: 25,
    })
  })

  it('prefers the neutral invoice amount for annual Enterprise metadata', () => {
    expect(
      parseEnterpriseSubscriptionMetadata({
        plan: 'enterprise',
        referenceId: 'org-1',
        invoiceAmountCents: '120000',
        seats: '25',
        reportingPeriodAnchorDate: '2026-01-31',
      })
    ).toMatchObject({
      invoiceAmountCents: 120000,
      invoiceAmountUsd: 1200,
      reportingPeriodAnchorDate: '2026-01-31',
    })
  })
})
