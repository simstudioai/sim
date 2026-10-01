/**
 * A failure that ends the turn as an error instead of handing it to a successor.
 * Only a controller that provably lost its chat lease hands off
 * ({@link StreamControllerSupersededError}); a replacement would meet any other failure
 * again, re-POSTing the same run to the worker on every reconnect poll.
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

/** Run-error code for a turn whose controller could not persist or verify its stream. */
export const STREAM_PERSISTENCE_FAILED_CODE = 'stream_persistence_failed'

/** Run-error code for a run whose controllers kept dying before it could finish. */
export const STREAM_RECOVERY_EXHAUSTED_CODE = 'stream_recovery_exhausted'

/**
 * The controller could not record an event to the replay buffer, or could not read its
 * own lease, for a reason other than losing it (a Redis error that outlasted the retries).
 */
export class StreamPersistenceFailedError extends StreamTurnFailure {
  readonly code = STREAM_PERSISTENCE_FAILED_CODE

  constructor(cause: unknown) {
    super('Stream persistence failed', { cause })
    this.name = 'StreamPersistenceFailedError'
  }

  get userMessage(): string {
    return 'This response was stopped because it could not be saved while streaming. The work it already completed has been saved — send a message to continue from there.'
  }
}

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
