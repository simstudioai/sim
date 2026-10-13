/**
 * A provider-side read failure whose message tells the caller what to do next, and whether the
 * same read may succeed if retried. Messages are written by Search code, never copied from a
 * provider response body.
 */
export class LiveReadError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number
  ) {
    super(message)
    this.name = 'LiveReadError'
  }
}
