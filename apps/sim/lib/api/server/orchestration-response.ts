import { NextResponse } from 'next/server'
import {
  asOrchestrationError,
  messageForOrchestrationError,
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
  if (!classified) return null
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
