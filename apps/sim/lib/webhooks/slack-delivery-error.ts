/** A missing acknowledgment does not establish that Slack rejected a write. */
export class SlackDeliveryError extends Error {
  constructor(
    readonly method: string,
    readonly outcome: 'rejected' | 'uncertain',
    readonly code: string,
    readonly httpStatus?: number
  ) {
    super(`Slack ${method}: ${code} (delivery ${outcome})`)
    this.name = 'SlackDeliveryError'
  }
}
