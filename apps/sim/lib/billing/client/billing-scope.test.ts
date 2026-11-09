import { describe, expect, it } from 'vitest'
import { resolveBillingScope } from '@/lib/billing/client/billing-scope'

describe('resolveBillingScope', () => {
  it('acts on the owner’s own billing for a personal organization', () => {
    expect(resolveBillingScope('org-personal', true)).toEqual({
      personal: true,
      invoices: { context: 'user' },
      portal: { context: 'user' },
      subscriptionReference: {},
    })
  })

  it('acts on the organization’s billing for a team', () => {
    expect(resolveBillingScope('org-team', false)).toEqual({
      personal: false,
      invoices: { context: 'organization', organizationId: 'org-team' },
      portal: { context: 'organization', organizationId: 'org-team' },
      subscriptionReference: { referenceId: 'org-team' },
    })
  })
})
