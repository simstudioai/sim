import type Stripe from 'stripe'
import { vi } from 'vitest'

/**
 * Mock for `@/lib/billing/stripe-client`.
 *
 * @example
 * ```ts
 * import { stripeClientMock, stripeClientMockFns } from '@sim/testing'
 * vi.mock('@/lib/billing/stripe-client', () => stripeClientMock)
 *
 * stripeClientMockFns.mockRequireStripeClient.mockReturnValue(fakeStripe)
 * ```
 */
export const stripeClientMockFns = {
  mockRequireStripeClient: vi.fn(),
  mockGetStripeClient: vi.fn(),
  mockHasValidStripeCredentials: vi.fn(() => true),
}

export const stripeClientMock = {
  requireStripeClient: stripeClientMockFns.mockRequireStripeClient,
  getStripeClient: stripeClientMockFns.mockGetStripeClient,
  hasValidStripeCredentials: stripeClientMockFns.mockHasValidStripeCredentials,
}

/**
 * Mock for `@/lib/billing/stripe-payment-method`.
 *
 * @example
 * ```ts
 * import { stripePaymentMethodMock, stripePaymentMethodMockFns } from '@sim/testing'
 * vi.mock('@/lib/billing/stripe-payment-method', () => stripePaymentMethodMock)
 * ```
 */
export const stripePaymentMethodMockFns = {
  mockResolveDefaultPaymentMethod: vi.fn(async () => ({
    paymentMethodId: undefined as string | undefined,
    collectionMethod: 'charge_automatically' as 'charge_automatically' | 'send_invoice' | null,
  })),
  mockGetCustomerId: vi.fn(),
}

export const stripePaymentMethodMock = {
  resolveDefaultPaymentMethod: stripePaymentMethodMockFns.mockResolveDefaultPaymentMethod,
  getCustomerId: stripePaymentMethodMockFns.mockGetCustomerId,
}

/**
 * Build a minimal `Stripe.Event` with the given type and object payload.
 * Fills in a deterministic `id` (`evt_${type}`) and nests `object` under
 * `data.object` as Stripe does.
 */
export function createMockStripeEvent<T = unknown>(
  type: string,
  object: T,
  overrides: Partial<Stripe.Event> = {}
): Stripe.Event {
  return {
    id: `evt_${type}`,
    object: 'event',
    api_version: '2024-06-20',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type,
    data: { object: object as unknown as Stripe.Event.Data.Object },
    ...overrides,
  } as Stripe.Event
}
