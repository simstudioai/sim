import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { guardrailsMaskBatchContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  maskPIIBatch,
  PiiServiceRejectedError,
  PiiServiceUnavailableError,
} from '@/lib/guardrails/validate_pii'

const logger = createLogger('GuardrailsMaskBatchAPI')

/**
 * Tells the mask client how to react to a failure: 422 = Presidio rejected this
 * input (never resend it), 503 = Presidio is down (retry, and stop sending queued
 * chunks), 500 = anything else (retry this chunk alone).
 */
function statusForMaskError(error: unknown): 422 | 503 | 500 {
  if (error instanceof PiiServiceRejectedError) return 422
  if (error instanceof PiiServiceUnavailableError) return 503
  return 500
}

/**
 * Internal batch PII masking. The log-redaction persist path runs in both the
 * Next.js server and the trigger.dev runtime, but only the app task reaches the
 * Presidio service (it holds `PII_URL` and the internal-network access) — so
 * redaction calls this endpoint server-to-server (internal JWT) to keep the
 * Presidio call centralized here.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(guardrailsMaskBatchContract, request, {})
  if (!parsed.success) return parsed.response

  const { texts, entityTypes, language, customPatterns } = parsed.data.body

  try {
    const startedAt = performance.now()
    const masked = await maskPIIBatch(texts, entityTypes, language, customPatterns)
    logger.info('Masked PII batch', {
      count: texts.length,
      durationMs: Math.round(performance.now() - startedAt),
    })
    return NextResponse.json({ masked })
  } catch (error) {
    // Fail loudly; the caller scrubs to REDACTION_FAILED, so PII is never leaked.
    const status = statusForMaskError(error)
    logger.error('PII batch masking failed', {
      error: getErrorMessage(error),
      count: texts.length,
      status,
    })
    return NextResponse.json({ error: getErrorMessage(error, 'PII masking failed') }, { status })
  }
})
