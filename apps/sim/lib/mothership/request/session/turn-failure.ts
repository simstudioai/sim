/**
 * A failure that ends the turn as an error instead of handing it to a successor
 * ({@link StreamControllerSupersededError}): a replacement would meet it again,
 * re-POSTing the same run to the worker on every reconnect poll.
 */
export abstract class StreamTurnFailure extends Error {
  abstract readonly code: string
  /** What the user is told. */
  abstract get userMessage(): string
}

/** The turn failure an abort reason or thrown value carries, if it is one. */
export function turnFailure(value: unknown): StreamTurnFailure | undefined {
  return value instanceof StreamTurnFailure ? value : undefined
}

/** Run-error code for a run whose controllers kept dying before it could finish. */
export const STREAM_RECOVERY_EXHAUSTED_CODE = 'stream_recovery_exhausted'

/** Recovery took over the run too many times without a controller staying alive. */
export class StreamRecoveryExhaustedError extends StreamTurnFailure {
  readonly code = STREAM_RECOVERY_EXHAUSTED_CODE

  constructor() {
    super('Stream recovery exhausted')
    this.name = 'StreamRecoveryExhaustedError'
  }

  get userMessage(): string {
    return 'This response was stopped because it was interrupted repeatedly. The work it already completed has been saved — send a message to continue from there.'
  }
}
