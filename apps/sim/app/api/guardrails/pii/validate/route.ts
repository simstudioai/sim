import { type NextRequest, NextResponse } from 'next/server'
import { guardrailsPiiValidateContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { validatePII } from '@/lib/guardrails/validate_pii'

/**
 * App-container capability boundary for single-text PII validation. Presidio is
 * intentionally ECS-internal, so remote workflow runtimes authenticate here
 * instead of importing its client and attempting to reach `PII_URL` directly.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(guardrailsPiiValidateContract, request, {})
  if (!parsed.success) return parsed.response

  const { text, entityTypes, mode, language, customPatterns } = parsed.data.body
  const result = await validatePII({
    text,
    entityTypes,
    mode,
    language,
    customPatterns,
    requestId: generateRequestId(),
    abortSignal: request.signal,
  })

  return NextResponse.json(guardrailsPiiValidateContract.response.schema.parse(result))
})
