import { NextResponse } from 'next/server'
import {
  asOrchestrationError,
  messageForOrchestrationError,
  type OrchestrationError,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'

/**
 * Maps a classified domain failure anywhere in `error`'s cause chain to its status for a
 * raw route; `null` when unclassified, so the caller logs it and returns its own 500. An
 * `internal` code answers with `fallback` rather than a message that may carry internals.
 */
export function orchestrationFailureResponse(
  error: unknown,
  fallback = 'Internal server error'
): NextResponse | null {
  const classified = asOrchestrationError(error)
  return classified ? classifiedResponse(classified, fallback) : null
}

/**
 * The 503 for an `unavailable` failure (the organization's egress route down, say); `null` for
 * any other error, which keeps the route's own handling.
 */
export function unavailableFailureResponse(error: unknown): NextResponse | null {
  const classified = asOrchestrationError(error)
  return classified?.code === 'unavailable'
    ? classifiedResponse(classified, 'Internal server error')
    : null
}

function classifiedResponse(classified: OrchestrationError, fallback: string): NextResponse {
  return NextResponse.json(
    {
      error: messageForOrchestrationError(
        { error: classified.message, errorCode: classified.code },
        fallback
      ),
    },
    { status: statusForOrchestrationError(classified.code) }
  )
}
