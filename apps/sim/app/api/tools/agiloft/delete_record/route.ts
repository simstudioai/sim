import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftDeleteRecordContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { isEwRestBody } from '@/tools/agiloft/ewrest'
import type { AgiloftDeleteResponse } from '@/tools/agiloft/types'
import { buildDeleteRecordUrl } from '@/tools/agiloft/utils'
import { executeAgiloftRequest } from '@/tools/agiloft/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftDeleteRecordAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Agiloft delete_record attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      agiloftDeleteRecordContract,
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

    const result = await executeAgiloftRequest<AgiloftDeleteResponse>(
      params,
      (base) => ({
        url: buildDeleteRecordUrl(base, params),
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
      async (response) => {
        const body = (await response.text()).trim()
        const recordId = params.recordId.trim()

        if (!response.ok) {
          return {
            success: false,
            output: { id: recordId, deleted: false },
            error: `Agiloft error: ${response.status} - ${body}`,
          }
        }

        /**
         * EWDelete returns nothing on success and an error message on failure,
         * so a non-empty body that is not an EWREST assignment is a refusal the
         * HTTP status did not surface — most often the delete rule rejecting
         * dependent records.
         */
        if (body && !isEwRestBody(body)) {
          return {
            success: false,
            output: { id: recordId, deleted: false },
            error: `Agiloft refused the delete: ${body}`,
          }
        }

        return { success: true, output: { id: recordId, deleted: true } }
      }
    )

    return NextResponse.json(result)
  } catch (error) {
    logger.error(`[${requestId}] Error deleting Agiloft record:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
