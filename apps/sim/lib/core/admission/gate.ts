import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { env } from '@/lib/core/config/env'

const logger = createLogger('AdmissionGate')

const MAX_INFLIGHT = Number.parseInt(env.ADMISSION_GATE_MAX_INFLIGHT ?? '') || 500

let inflight = 0

export interface AdmissionTicket {
  release: () => void
}

/**
 * Attempts to admit a request through the in-process gate.
 * Returns a ticket with a release() handle on success, or null if at capacity.
 * Zero external calls — purely in-process atomic counter.
 */
export function tryAdmit(): AdmissionTicket | null {
  if (inflight >= MAX_INFLIGHT) {
    return null
  }

  inflight++
  let released = false

  return {
    release() {
      if (released) return
      released = true
      inflight--
    },
  }
}

/**
 * Returns a 429 response for requests rejected by the admission gate.
 */
export function admissionRejectedResponse(): NextResponse {
  logger.warn('Admission gate rejecting request', { inflight, maxInflight: MAX_INFLIGHT })
  return NextResponse.json(
    {
      error: 'Too many requests',
      message: 'Server is at capacity. Please retry shortly.',
      retryAfterSeconds: 5,
    },
    {
      status: 429,
      headers: { 'Retry-After': '5' },
    }
  )
}

/**
 * Returns the current gate metrics for observability.
 */
export function getAdmissionGateStatus(): { inflight: number; maxInflight: number } {
  return { inflight, maxInflight: MAX_INFLIGHT }
}
