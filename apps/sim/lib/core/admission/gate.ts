import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { ADMISSION_ERROR_DESCRIPTOR } from '@/lib/core/admission/transient-failure'
import { env } from '@/lib/core/config/env'

const logger = createLogger('AdmissionGate')

/**
 * Default matches the web DB pool (`primaryMax=10`) so admitted in-process work
 * cannot silently outrun shared connections + heap. Override per pod via env.
 */
const MAX_INFLIGHT = Number.parseInt(env.ADMISSION_GATE_MAX_INFLIGHT ?? '') || 10

let inflight = 0

export interface AdmissionTicket {
  release: () => void
}

/**
 * Attempts to admit a request through the in-process gate.
 * Returns a ticket with a release() handle on success, or null if at capacity.
 * Zero external calls — purely in-process atomic counter. Each pod maintains its
 * own counter, so the effective aggregate limit across N pods is N × MAX_INFLIGHT.
 * Configure ADMISSION_GATE_MAX_INFLIGHT per pod based on what each pod can sustain.
 *
 * Callers that run work inline after returning HTTP 202 must retain the ticket
 * until that work finishes — releasing on response alone does not bound
 * concurrent executions.
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
  const descriptor = ADMISSION_ERROR_DESCRIPTOR.GATE_CAPACITY
  logger.warn('Admission gate rejecting request', { inflight, maxInflight: MAX_INFLIGHT })
  return NextResponse.json(
    {
      error: 'Too many requests',
      message: 'Server is at capacity. Please retry shortly.',
      code: descriptor.code,
      retryable: descriptor.retryable,
      retryAfterSeconds: descriptor.retryAfterSeconds,
    },
    {
      status: descriptor.statusCode,
      headers: { 'Retry-After': String(descriptor.retryAfterSeconds) },
    }
  )
}

/**
 * Returns the current gate metrics for observability.
 */
export function getAdmissionGateStatus(): { inflight: number; maxInflight: number } {
  return { inflight, maxInflight: MAX_INFLIGHT }
}
