import {
  idempotencyServiceMock,
  idempotencyServiceMockFns,
} from '@sim/testing/mocks/idempotency-service.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/idempotency/service', () => idempotencyServiceMock)

import {
  claimCheckoutAdmission,
  releaseCheckoutAdmission,
  resolveCheckoutReferenceId,
} from '@/lib/billing/checkout-admission'

const { mockAtomicallyClaim, mockRelease } = idempotencyServiceMockFns

describe('checkout admission', () => {
  beforeEach(() => {
    mockAtomicallyClaim.mockReset()
    mockRelease.mockReset()
    mockRelease.mockResolvedValue(undefined)
  })

  it('resolves explicit, organization, and personal references like Better Auth', () => {
    expect(
      resolveCheckoutReferenceId({ referenceId: 'org-explicit' }, 'user-1', 'org-active')
    ).toBe('org-explicit')
    expect(
      resolveCheckoutReferenceId({ customerType: 'organization' }, 'user-1', 'org-active')
    ).toBe('org-active')
    expect(resolveCheckoutReferenceId({}, 'user-1', 'org-active')).toBe('user-1')
  })

  it('admits only one overlapping checkout for a billing reference', async () => {
    mockAtomicallyClaim
      .mockResolvedValueOnce({
        claimed: true,
        normalizedKey: 'billing-checkout-admission:stripe:org-1',
        storageMethod: 'database',
        claimToken: 'claim-1',
      })
      .mockResolvedValueOnce({
        claimed: false,
        normalizedKey: 'billing-checkout-admission:stripe:org-1',
        storageMethod: 'database',
        existingResult: { status: 'in-progress' },
      })

    const firstClaim = await claimCheckoutAdmission('org-1')
    await expect(claimCheckoutAdmission('org-1')).rejects.toThrow(
      /checkout is already being started/
    )
    expect(firstClaim.claimToken).toBe('claim-1')
  })

  it('releases only the claim owned by this request', async () => {
    await releaseCheckoutAdmission({
      normalizedKey: 'billing-checkout-admission:stripe:org-1',
      storageMethod: 'database',
      claimToken: 'claim-1',
    })

    expect(mockRelease).toHaveBeenCalledWith(
      'billing-checkout-admission:stripe:org-1',
      'database',
      'claim-1'
    )
  })

  it('does not replace a successful checkout response when release fails', async () => {
    mockRelease.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(
      releaseCheckoutAdmission({
        normalizedKey: 'billing-checkout-admission:stripe:org-1',
        storageMethod: 'database',
        claimToken: 'claim-1',
      })
    ).resolves.toBeUndefined()
  })
})
