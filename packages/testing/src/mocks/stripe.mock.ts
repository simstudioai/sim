import type Stripe from 'stripe'
import { vi } from 'vitest'

/**
 * Mock for `@/lib/billing/stripe-client`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/stripe-client', () => stripeClientMock)
 * stripeClientMock.requireStripeClient.mockReturnValue(fakeStripe)
 * ```
 */
export const stripeClientMock = {
  requireStripeClient: vi.fn(),
  getStripeClient: vi.fn(),
  hasValidStripeCredentials: vi.fn(() => true),
}

/**
 * Mock for `@/lib/billing/stripe-payment-method`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/stripe-payment-method', () => stripePaymentMethodMock)
 * ```
 */
export const stripePaymentMethodMock = {
  resolveDefaultPaymentMethod: vi.fn(async () => ({
    paymentMethodId: undefined as string | undefined,
    collectionMethod: 'charge_automatically' as 'charge_automatically' | 'send_invoice' | null,
  })),
  getCustomerId: vi.fn(),
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

/** A Stripe subscription as the in-memory fake stores it: the fields billing code reads. */
export interface InMemoryStripeSubscription {
  id: string
  object: 'subscription'
  customer: string
  status: Stripe.Subscription.Status
  cancel_at_period_end: boolean
  cancel_at: number | null
  canceled_at: number | null
  ended_at: number | null
  trial_start: number | null
  trial_end: number | null
  schedule: string | null
  collection_method: Stripe.Subscription.CollectionMethod
  days_until_due: number | null
  pause_collection: InMemoryStripePauseCollection | null
  metadata: Record<string, string>
  items: {
    object: 'list'
    data: Array<{
      id: string
      quantity: number
      current_period_start: number
      current_period_end: number
      price: {
        id: string
        currency: string
        unit_amount: number | null
        recurring: { interval: 'month' | 'year' }
      }
    }>
  }
}

/** A subscription's paused invoice collection, as Stripe reports it. */
interface InMemoryStripePauseCollection {
  behavior: 'keep_as_draft' | 'mark_uncollectible' | 'void'
  resumes_at: number | null
}

/** A Stripe customer as the in-memory fake stores it. */
export interface InMemoryStripeCustomer {
  id: string
  object: 'customer'
  email: string | null
  name: string | null
}

/** A request the fake parked on arrival, before Stripe processes it. */
export interface InMemoryStripeRequestGate {
  /** Resolves once the parked request has reached the fake. */
  reached: Promise<void>
  /** Lets the parked request proceed to Stripe's processing. */
  release(): void
}

type UpdatableResource = 'subscriptions' | 'customers'
type StripeOperation = `${UpdatableResource}.${'retrieve' | 'update'}`

interface SubscriptionUpdateParams {
  cancel_at_period_end?: boolean
  /** A Unix timestamp schedules the cancellation; `''` clears it. Only `cancel_at` changes. */
  cancel_at?: number | ''
  metadata?: Record<string, string>
  items?: Array<{ id: string; quantity?: number; price?: string }>
  /** `''` resumes collection, as in Stripe's API. */
  pause_collection?:
    | { behavior: InMemoryStripePauseCollection['behavior']; resumes_at?: number }
    | ''
}

interface CustomerUpdateParams {
  email?: string
  name?: string
}

/**
 * An in-memory Stripe account for integration tests that need Stripe to behave like Stripe:
 * `retrieve` returns current state, `update` applies params and emits the
 * `customer.subscription.updated` event Stripe would send (with `previous_attributes` and the
 * originating `request.idempotency_key`), and a reused idempotency key replays the first
 * response, or rejects when its parameters differ. A test can park the next request on a gate to
 * control the order requests land in (a parked retrieve answers with the state it arrived to), or make the next update apply and then fail on the
 * client, as a dropped connection does.
 *
 * @example
 * ```ts
 * const stripe = createInMemoryStripe()
 * stripeClientMock.requireStripeClient.mockReturnValue(stripe.client)
 * const gate = stripe.holdNextRequest('subscriptions.update')
 * ```
 */
export function createInMemoryStripe() {
  const subscriptions = new Map<string, InMemoryStripeSubscription>()
  const customers = new Map<string, InMemoryStripeCustomer>()
  const idempotentResults = new Map<string, { fingerprint: string; result: unknown }>()
  const gates = new Map<StripeOperation, Array<{ reached: () => void; released: Promise<void> }>>()
  const failuresAfterApply = new Map<UpdatableResource, Error[]>()
  const failuresOnArrival = new Map<StripeOperation, Error[]>()
  const events: Stripe.Event[] = []
  let sequence = 0

  function nextId(prefix: string) {
    sequence += 1
    return `${prefix}_${sequence}`
  }

  function requireSubscription(id: string) {
    const subscription = subscriptions.get(id)
    if (!subscription) throw new Error(`No such subscription: '${id}'`)
    return subscription
  }

  function requireCustomer(id: string) {
    const customer = customers.get(id)
    if (!customer) throw new Error(`No such customer: '${id}'`)
    return customer
  }

  function applySubscriptionUpdate(
    id: string,
    params: SubscriptionUpdateParams,
    idempotencyKey: string | null
  ) {
    const current = requireSubscription(id)
    const next = structuredClone(current)
    const previousAttributes: Record<string, unknown> = {}
    if (
      params.cancel_at_period_end !== undefined &&
      params.cancel_at_period_end !== current.cancel_at_period_end
    ) {
      previousAttributes.cancel_at_period_end = current.cancel_at_period_end
      next.cancel_at_period_end = params.cancel_at_period_end
    }
    if (params.cancel_at !== undefined) {
      const cancelAt = params.cancel_at === '' ? null : params.cancel_at
      if (cancelAt !== current.cancel_at) {
        previousAttributes.cancel_at = current.cancel_at
        next.cancel_at = cancelAt
      }
    }
    if (params.pause_collection !== undefined) {
      const pauseCollection =
        params.pause_collection === ''
          ? null
          : {
              behavior: params.pause_collection.behavior,
              resumes_at: params.pause_collection.resumes_at ?? null,
            }
      if (JSON.stringify(pauseCollection) !== JSON.stringify(current.pause_collection)) {
        previousAttributes.pause_collection = current.pause_collection
        next.pause_collection = pauseCollection
      }
    }
    if (params.metadata) {
      const metadata = { ...current.metadata, ...params.metadata }
      if (JSON.stringify(metadata) !== JSON.stringify(current.metadata)) {
        previousAttributes.metadata = current.metadata
        next.metadata = metadata
      }
    }
    for (const item of params.items ?? []) {
      const target = next.items.data.find((existing) => existing.id === item.id)
      if (!target) throw new Error(`No such subscription item: '${item.id}'`)
      if (item.quantity !== undefined) target.quantity = item.quantity
      if (item.price !== undefined) target.price = { ...target.price, id: item.price }
    }
    if (JSON.stringify(next.items) !== JSON.stringify(current.items)) {
      previousAttributes.items = current.items
    }
    subscriptions.set(id, next)
    if (Object.keys(previousAttributes).length > 0) {
      events.push({
        id: nextId('evt'),
        object: 'event',
        api_version: '2025-08-27.basil',
        created: sequence,
        livemode: false,
        pending_webhooks: 1,
        request: { id: nextId('req'), idempotency_key: idempotencyKey },
        type: 'customer.subscription.updated',
        data: {
          object: structuredClone(next) as unknown as Stripe.Subscription,
          previous_attributes: previousAttributes as Partial<Stripe.Subscription>,
        },
      } as Stripe.Event)
    }
    return structuredClone(next)
  }

  function rejectIfFailing(operation: StripeOperation) {
    const failure = failuresOnArrival.get(operation)?.shift()
    if (failure) throw failure
  }

  async function waitAtGate(operation: StripeOperation) {
    const gate = gates.get(operation)?.shift()
    if (gate) {
      gate.reached()
      await gate.released
    }
  }

  async function retrieve<T>(operation: StripeOperation, read: () => T): Promise<T> {
    rejectIfFailing(operation)
    const snapshot = structuredClone(read())
    await waitAtGate(operation)
    return snapshot
  }

  async function update<T>(
    resource: UpdatableResource,
    id: string,
    params: unknown,
    options: { idempotencyKey?: string } | undefined,
    apply: () => T
  ): Promise<T> {
    rejectIfFailing(`${resource}.update`)
    await waitAtGate(`${resource}.update`)

    const idempotencyKey = options?.idempotencyKey
    const fingerprint = JSON.stringify([resource, id, params])
    if (idempotencyKey) {
      const previous = idempotentResults.get(idempotencyKey)
      if (previous && previous.fingerprint !== fingerprint) {
        throw Object.assign(
          new Error(
            'Keys for idempotent requests can only be used with the same parameters they were first used with.'
          ),
          { type: 'StripeIdempotencyError' }
        )
      }
      if (previous) return structuredClone(previous.result) as T
    }

    const result = apply()
    if (idempotencyKey) idempotentResults.set(idempotencyKey, { fingerprint, result })
    const failure = failuresAfterApply.get(resource)?.shift()
    if (failure) throw failure
    return structuredClone(result)
  }

  const client = {
    subscriptions: {
      retrieve: (id: string) => retrieve('subscriptions.retrieve', () => requireSubscription(id)),
      update: (
        id: string,
        params: SubscriptionUpdateParams,
        options?: { idempotencyKey?: string }
      ) =>
        update('subscriptions', id, params, options, () =>
          applySubscriptionUpdate(id, params, options?.idempotencyKey ?? null)
        ),
    },
    customers: {
      retrieve: (id: string) => retrieve('customers.retrieve', () => requireCustomer(id)),
      update: (id: string, params: CustomerUpdateParams, options?: { idempotencyKey?: string }) =>
        update('customers', id, params, options, () => {
          const next = { ...requireCustomer(id), ...params }
          customers.set(id, next)
          return structuredClone(next)
        }),
    },
    webhooks: {
      constructEventAsync: async (payload: string) => JSON.parse(payload) as Stripe.Event,
    },
  }

  return {
    /** Pass to `stripeClientMock.requireStripeClient` or to the Better Auth Stripe plugin. */
    client: client as unknown as Stripe,
    /** Every `customer.subscription.updated` event Stripe emitted, in the order it applied them. */
    events,
    addSubscription(
      subscription: Pick<InMemoryStripeSubscription, 'id' | 'customer'> &
        Partial<
          Pick<InMemoryStripeSubscription, 'status' | 'cancel_at_period_end' | 'cancel_at'>
        > & {
          quantity?: number
          priceId?: string
          /** Price amount in cents; omitted for prices whose amount no test reads. */
          unitAmount?: number
          metadata?: Record<string, string>
          /** `send_invoice` subscriptions get Stripe's `days_until_due` of 30. */
          collectionMethod?: Stripe.Subscription.CollectionMethod
        }
    ) {
      const now = Math.floor(Date.now() / 1000)
      subscriptions.set(subscription.id, {
        id: subscription.id,
        object: 'subscription',
        customer: subscription.customer,
        status: subscription.status ?? 'active',
        cancel_at_period_end: subscription.cancel_at_period_end ?? false,
        cancel_at: subscription.cancel_at ?? null,
        canceled_at: null,
        ended_at: null,
        trial_start: null,
        trial_end: null,
        schedule: null,
        collection_method: subscription.collectionMethod ?? 'charge_automatically',
        days_until_due: subscription.collectionMethod === 'send_invoice' ? 30 : null,
        pause_collection: null,
        metadata: { ...subscription.metadata },
        items: {
          object: 'list',
          data: [
            {
              id: `si_${subscription.id}`,
              quantity: subscription.quantity ?? 1,
              current_period_start: now,
              current_period_end: now + 30 * 24 * 60 * 60,
              price: {
                id: subscription.priceId ?? `price_${subscription.id}`,
                currency: 'usd',
                unit_amount: subscription.unitAmount ?? null,
                recurring: { interval: 'month' },
              },
            },
          ],
        },
      })
    },
    addCustomer(customer: Pick<InMemoryStripeCustomer, 'id' | 'email' | 'name'>) {
      customers.set(customer.id, { ...customer, object: 'customer' })
    },
    subscription: (id: string) => structuredClone(requireSubscription(id)),
    customer: (id: string) => structuredClone(requireCustomer(id)),
    /** Applies a change made outside Sim (dashboard, customer portal) and emits its event. */
    updateOutsideSim(id: string, params: SubscriptionUpdateParams) {
      return applySubscriptionUpdate(id, params, null)
    },
    /** Parks the next call to `operation` until the returned gate is released. */
    holdNextRequest(operation: StripeOperation): InMemoryStripeRequestGate {
      let reached: () => void = () => {}
      const arrival = new Promise<void>((resolve) => {
        reached = resolve
      })
      let release: () => void = () => {}
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      gates.set(operation, [...(gates.get(operation) ?? []), { reached, released }])
      return { reached: arrival, release }
    },
    /** Makes the next call to `operation` fail before Stripe processes it, as an outage does. */
    failNextRequest(operation: StripeOperation, error = new Error('Stripe is unavailable')) {
      failuresOnArrival.set(operation, [...(failuresOnArrival.get(operation) ?? []), error])
    },
    /** Makes the next update to `resource` apply in Stripe, then fail on the client. */
    failNextUpdateAfterApplying(resource: UpdatableResource, error = new Error('socket hang up')) {
      failuresAfterApply.set(resource, [...(failuresAfterApply.get(resource) ?? []), error])
    },
  }
}

export type InMemoryStripe = ReturnType<typeof createInMemoryStripe>
