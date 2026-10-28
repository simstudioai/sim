/**
 * A subscription whose `referenceId` matches neither an organization nor a user — typically an
 * organization deleted while its Stripe subscription stayed live. The condition is permanent: no
 * retry can resolve the reference, so webhook paths acknowledge the event and log it instead of
 * failing it into Stripe's retry loop.
 */
export class SubscriptionReferenceNotFoundError extends Error {
  readonly referenceId: string

  constructor(referenceId: string) {
    super(`Subscription reference ${referenceId} does not match a user or organization`)
    this.name = 'SubscriptionReferenceNotFoundError'
    this.referenceId = referenceId
  }
}
