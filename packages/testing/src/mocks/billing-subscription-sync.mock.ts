import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/billing/webhooks/subscription-sync`. The enqueue
 * functions resolve to a fixed event id; drive them with `mockResolvedValueOnce`.
 *
 * @example
 * ```ts
 * import { billingSubscriptionSyncMockFns } from '@sim/testing/mocks/billing-subscription-sync.mock'
 *
 * expect(billingSubscriptionSyncMockFns.mockEnqueueCancelAtPeriodEndSync).toHaveBeenCalledWith(
 *   expect.anything(),
 *   expect.objectContaining({ cancelAtPeriodEnd: true })
 * )
 * ```
 */
export const billingSubscriptionSyncMockFns = {
  mockEnqueueCancelAtPeriodEndSync: vi.fn(async () => 'cancel-at-period-end-sync-event'),
  mockRecommitCancelAtPeriodEndSync: vi.fn(async () => undefined),
  mockEnqueueSubscriptionSeatsSync: vi.fn(async () => 'subscription-seats-sync-event'),
  mockCancelAtPeriodEndSyncIdempotencyKey: vi.fn(
    (eventId: string) => `outbox-sync-cancel-at-period-end:${eventId}:key`
  ),
  mockReconcileSubscriptionSyncFromStripe: vi.fn(async () => undefined),
}

/**
 * Static mock module for `@/lib/billing/webhooks/subscription-sync`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/webhooks/subscription-sync', () => billingSubscriptionSyncMock)
 * ```
 */
export const billingSubscriptionSyncMock = {
  enqueueCancelAtPeriodEndSync: billingSubscriptionSyncMockFns.mockEnqueueCancelAtPeriodEndSync,
  recommitCancelAtPeriodEndSync: billingSubscriptionSyncMockFns.mockRecommitCancelAtPeriodEndSync,
  enqueueSubscriptionSeatsSync: billingSubscriptionSyncMockFns.mockEnqueueSubscriptionSeatsSync,
  cancelAtPeriodEndSyncIdempotencyKey:
    billingSubscriptionSyncMockFns.mockCancelAtPeriodEndSyncIdempotencyKey,
  reconcileSubscriptionSyncFromStripe:
    billingSubscriptionSyncMockFns.mockReconcileSubscriptionSyncFromStripe,
}
