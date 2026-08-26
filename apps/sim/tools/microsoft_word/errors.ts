/**
 * An error whose cause is the caller's input rather than anything Microsoft
 * Graph did.
 *
 * The Word routes validate identifiers and names in shared helpers that run
 * after contract parsing, because they encode Graph's path rules rather than
 * the wire shape. Without a distinct type those failures reach the route's
 * error projection as ordinary `Error`s and are reported as 500s, telling the
 * caller that Sim broke when in fact they sent a malformed document ID.
 */
export class MicrosoftWordInputError extends Error {
  readonly status = 400

  constructor(message: string) {
    super(message)
    this.name = 'MicrosoftWordInputError'
  }
}
