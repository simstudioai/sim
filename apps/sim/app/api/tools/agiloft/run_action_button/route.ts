import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftRunActionButtonContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { parseEwRest } from '@/tools/agiloft/ewrest'
import type { AgiloftRunActionButtonResponse } from '@/tools/agiloft/types'
import { buildRunActionButtonUrl, describeAgiloftError } from '@/tools/agiloft/utils'
import { executeEwRequest } from '@/tools/agiloft/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftRunActionButtonAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(
        `[${requestId}] Unauthorized Agiloft run_action_button attempt: ${authResult.error}`
      )
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      agiloftRunActionButtonContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid request data`, { errors: error.issues })
          return NextResponse.json(
            {
              success: false,
              error: getValidationErrorMessage(error, 'Invalid request data'),
              details: error.issues,
            },
            { status: 400 }
          )
        },
      }
    )
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    const result = await executeEwRequest<AgiloftRunActionButtonResponse>(
      params,
      (base) => ({
        url: buildRunActionButtonUrl(base, params),
        /** EWActionButton is documented as POST-only. */
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
      async (response) => {
        const body = await response.text()
        const recordId = params.recordId.trim()

        if (!response.ok) {
          return {
            success: false,
            output: { recordId, callbackId: null },
            error: `Agiloft error ${response.status}: ${describeAgiloftError(body)}`,
          }
        }

        /** Documented response: EWREST_id='82'; EWREST_EWCALLBACK_ID='10100_1'; */
        const values = parseEwRest(body)
        if (values.size === 0) {
          return {
            success: false,
            output: { recordId, callbackId: null },
            error: `Agiloft did not acknowledge the action button: ${body.trim() || '(empty response)'}`,
          }
        }

        return {
          success: true,
          output: {
            recordId: values.get('id') ?? recordId,
            callbackId: values.get('EWCALLBACK_ID') ?? null,
          },
        }
      }
    )

    return NextResponse.json(result)
  } catch (error) {
    logger.error(`[${requestId}] Error running Agiloft action button:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
