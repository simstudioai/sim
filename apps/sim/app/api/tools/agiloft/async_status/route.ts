import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftAsyncStatusContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { AgiloftAsyncStatusResponse } from '@/tools/agiloft/types'
import { AGILOFT_ASYNC_STATUS, buildAsyncStatusUrl } from '@/tools/agiloft/utils'
import { executeEwRequest } from '@/tools/agiloft/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftAsyncStatusAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Agiloft async_status attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      agiloftAsyncStatusContract,
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

    const result = await executeEwRequest<AgiloftAsyncStatusResponse>(
      params,
      (base) => ({ url: buildAsyncStatusUrl(base, params), method: 'GET' }),
      async (response) => {
        /**
         * EWAsyncStatus communicates entirely through the status code and
         * returns an empty body, so the code is the result rather than an
         * error signal — 501 means the async operation failed, not that the
         * status check did.
         */
        const known = AGILOFT_ASYNC_STATUS[response.status]

        if (!known) {
          const body = await response.text()
          return {
            success: false,
            output: {
              callbackId: params.callbackId.trim(),
              statusCode: response.status,
              status: 'unrecognized',
              complete: false,
            },
            error: `Agiloft returned an unrecognized async status ${response.status}: ${body.trim() || '(empty response)'}`,
          }
        }

        return {
          success: true,
          output: {
            callbackId: params.callbackId.trim(),
            statusCode: response.status,
            status: known.status,
            complete: known.complete,
          },
        }
      }
    )

    return NextResponse.json(result)
  } catch (error) {
    logger.error(`[${requestId}] Error checking Agiloft async status:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
