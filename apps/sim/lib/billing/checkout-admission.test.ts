/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAtomicallyClaim, mockRelease, mockIdempotencyService } = vi.hoisted(() => ({
  mockAtomicallyClaim: vi.fn(),
  mockRelease: vi.fn(),
  mockIdempotencyService: vi.fn(),
}))

vi.mock('@/lib/core/idempotency/service', () => ({
  IdempotencyService: class MockIdempotencyService {
    constructor(options: unknown) {
      mockIdempotencyService(options)
    }

    atomicallyClaim(...args: unknown[]) {
      return mockAtomicallyClaim(...args)
    }

    release(...args: unknown[]) {
      return mockRelease(...args)
    }
  },
}))

import {
  claimCheckoutAdmission,
  releaseCheckoutAdmission,
  resolveCheckoutReferenceId,
} from '@/lib/billing/checkout-admission'

describe('checkout admission', () => {
  beforeEach(() => {
    mockAtomicallyClaim.mockReset()
    mockRelease.mockReset()
    mockRelease.mockResolvedValue(undefined)
  })

  it('uses durable, short-lived database claims', () => {
    expect(mockIdempotencyService).toHaveBeenCalledWith({
      namespace: 'billing-checkout-admission',
      ttlSeconds: 120,
      inProgressTtlSeconds: 120,
      retryFailures: true,
      storeResultBody: false,
      forceStorage: 'database',
    })
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
