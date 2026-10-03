/**
 * What is known about the peer's state once a delivery has stopped being
 * retried.
 *
 * - `indeterminate` — it is unknown whether the peer committed. The request may
 *   never have arrived, or it may have been applied and the acknowledgement
 *   lost before a single response byte was written. Read it as "unknown", never
 *   as "nothing happened": a peer that commits and then dies is the single most
 *   common ambiguous failure, and it is indistinguishable from a request that
 *   never landed.
 * - `delivered-unacknowledged` — the peer sent response headers, so it accepted
 *   and committed the request; only our read of its answer failed. A duplicate
 *   would be a second real effect.
 * - `possibly-billed` — a `billable` delivery reached the post-header phase, so
 *   metering may already have happened at the peer.
 */
export type DeliveryOutcome = 'indeterminate' | 'delivered-unacknowledged' | 'possibly-billed'

/**
 * Where a `keyed` delivery's idempotency token is carried on the wire.
 *
 * `bodyField.path` is a dot path into a JSON request body
 * (`'metadata.idempotency_key'`). Placing a token in the body re-serializes it,
 * so key order and number formatting change — never use `bodyField` on a body
 * whose exact bytes are signed or hashed (AWS SigV4 payload hashes, HMAC
 * webhook signatures). Prefer `header` unless the provider offers no header.
 */
export type KeyedTokenPlacement =
  | { readonly kind: 'header'; readonly name: string }
  | { readonly kind: 'bodyField'; readonly path: string }

interface DeliveryDeclarationBase {
  /**
   * What a duplicate of this request would mean to the user, in their terms —
   * not the mechanism. "The customer would receive the invoice email twice",
   * not "POST /messages is not idempotent".
   */
  readonly why: string
}

/**
 * The peer deduplicates on a token we supply, so a duplicate is collapsed on
 * their side. This requires the token to be *identical* across every layer of
 * retry above this one, and *distinct* for every logically separate invocation
 * within one run — see `deriveDeliveryKey` and `KeyedDeliveryContext`.
 */
export type KeyedDeliveryDeclaration = {
  readonly deliveryClass: 'keyed'
  readonly tokenPlacement: KeyedTokenPlacement
  /**
   * How long the provider honors the token, in seconds. Retrying outside this
   * window produces a second real effect, so it bounds the attempt span of a
   * single `deliver` call. It cannot bound retry layers above `deliver`, which
   * re-enter with a fresh clock; pass `windowStartedAtMs` to hold one window
   * across those layers.
   */
  readonly providerWindowSeconds: number
} & DeliveryDeclarationBase

/**
 * A declaration of the user-visible consequence of delivering a request more
 * than once. Every outbound call that `deliver` wraps carries exactly one.
 *
 * Declare a call site's class as a literal, or with `satisfies` when it is
 * hoisted to a constant. Annotating a constant `: DeliveryDeclaration` widens it
 * to the whole union and `deliver` will reject it, because the `keyed` branch
 * demands a stricter context than the others.
 *
 * ```ts
 * const SEND = {
 *   deliveryClass: 'once',
 *   why: 'the recipient would see the message twice',
 *   userVisibleEffect: 'a second message in the channel',
 * } satisfies DeliveryDeclaration
 * ```
 */
export type DeliveryDeclaration =
  /** No peer state changes. A duplicate is invisible. */
  | ({ readonly deliveryClass: 'read' } & DeliveryDeclarationBase)
  /**
   * The peer converges on the same state however many times it is applied — a
   * full-document PUT, a DELETE, a set-to-value. A duplicate is invisible.
   */
  | ({ readonly deliveryClass: 'converge' } & DeliveryDeclarationBase)
  | KeyedDeliveryDeclaration
  /**
   * A duplicate meters or charges twice. Never retried, in either phase: the
   * pre-header phase proves only that no acknowledgement was written, not that
   * the peer declined to act.
   */
  | ({ readonly deliveryClass: 'billable' } & DeliveryDeclarationBase)
  /**
   * A duplicate produces a second effect the user can see and cannot undo —
   * a second Slack message, a second payment, a second row.
   */
  | ({
      readonly deliveryClass: 'once'
      /**
       * The concrete artifact a duplicate would create, surfaced on
       * `DeliveryFailure` so an operator reading a failed run knows exactly
       * what to check for. "A second message in the channel."
       */
      readonly userVisibleEffect: string
    } & DeliveryDeclarationBase)

/** Every declaration except `keyed`, which carries a stricter delivery context. */
export type UnkeyedDeliveryDeclaration = Exclude<DeliveryDeclaration, KeyedDeliveryDeclaration>

/**
 * Delivery classes describe what a *duplicate* of an outbound request would
 * mean to the user, which is the only question that decides whether a failed
 * request may be sent again.
 *
 * The transport cannot answer it: a severed socket looks identical whether the
 * peer ignored the bytes or charged a card. So the call site declares the
 * consequence once, and `DELIVERY_POLICY` turns that declaration into a retry
 * decision.
 *
 * Derived from {@link DeliveryDeclaration} rather than declared alongside it, so
 * a class can never exist without a way to declare it.
 */
export type DeliveryClass = DeliveryDeclaration['deliveryClass']

/**
 * Identity function whose parameter type welds a runtime class list to the
 * declaration union in both directions: an entry with no declaration variant
 * fails the `readonly DeliveryClass[]` constraint, and a declaration variant
 * missing from the list collapses the second intersection member to `never`.
 */
function exhaustiveClassList<T extends readonly DeliveryClass[]>(
  classes: T & ([DeliveryClass] extends [T[number]] ? unknown : never)
): T {
  return classes
}

/** Every delivery class, for audits and exhaustive iteration. */
export const DELIVERY_CLASSES = exhaustiveClassList([
  'read',
  'converge',
  'keyed',
  'billable',
  'once',
] as const)
