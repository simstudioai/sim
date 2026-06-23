import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { guardrailsMaskBatchContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { maskPIIBatch } from '@/lib/guardrails/validate_pii'

const logger = createLogger('GuardrailsMaskBatchAPI')

/**
 * Internal batch PII masking. The log-redaction persist path runs in both the
 * Next.js server and the trigger.dev runtime, but the Presidio sidecars live only
 * in the app task — so redaction calls this endpoint server-to-server (internal
 * JWT) to keep Presidio centralized here.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(guardrailsMaskBatchContract, request, {})
  if (!parsed.success) return parsed.response

  const { texts, entityTypes, language } = parsed.data.body

  try {
    const masked = await maskPIIBatch(texts, entityTypes, language)
    logger.info('Masked PII batch', { count: texts.length })
    return NextResponse.json({ masked })
  } catch (error) {
    // An unreachable/misconfigured Presidio sidecar makes maskPIIBatch throw; fail
    // loudly here (the caller scrubs to REDACTION_FAILED, so PII is never leaked).
    logger.error('PII batch masking failed', {
      error: getErrorMessage(error),
      count: texts.length,
    })
    return NextResponse.json(
      { error: getErrorMessage(error, 'PII masking failed') },
      { status: 500 }
    )
  }
})
