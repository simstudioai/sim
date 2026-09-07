import { backoffWithJitter } from '@sim/utils/retry'
import { ORCHESTRATION_TIMEOUT_MS } from '@/lib/mothership/constants'
import { StreamContinuityError } from '@/lib/mothership/request/go/parser'
import {
  CopilotBackendError,
  StreamEndedWithoutTerminalError,
} from '@/lib/mothership/request/go/stream'

const MAX_STREAM_RETRIES = 3
const STREAM_RECOVERY_WINDOW_MS = 30_000

/** Recovery is bounded independently of the healthy run's execution budget. */
export class StreamRetryWindow {
  private readonly deadline: number
  private recoveryDeadline?: number
  attempt = 0

  constructor(timeoutMs = ORCHESTRATION_TIMEOUT_MS) {
    this.deadline = Date.now() + timeoutMs
  }

  remainingMs(): number {
    const remaining = this.deadline - Date.now()
    if (remaining <= 0)
      throw new Error('The connection to the assistant could not be restored in time.')
    return remaining
  }

  nextDelay(error: unknown, signal?: AbortSignal): number | null {
    if (signal?.aborted || !isRetryableStreamError(error)) return null
    this.recoveryDeadline ??= Date.now() + STREAM_RECOVERY_WINDOW_MS
    if (this.attempt >= MAX_STREAM_RETRIES) return null
    const delay = backoffWithJitter(this.attempt + 1, null, { baseMs: 250, maxMs: 5_000 })
    if (Date.now() + delay >= Math.min(this.deadline, this.recoveryDeadline)) return null
    this.attempt++
    return delay
  }
}

/** Initial sends and resumes both replay one durable identity after an ambiguous response. */
function isRetryableStreamError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return false
  if (error instanceof StreamEndedWithoutTerminalError || error instanceof StreamContinuityError) {
    return true
  }
  if (error instanceof CopilotBackendError) {
    return error.status !== undefined && error.status >= 500
  }
  return error instanceof TypeError
}
