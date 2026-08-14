import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftSelectRecordsContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { parseEwRest, toRecordIds } from '@/tools/agiloft/ewrest'
import type { AgiloftSelectResponse } from '@/tools/agiloft/types'
import {
  AGILOFT_MAX_SELECT_IDS,
  buildSelectRecordsUrl,
  describeAgiloftError,
  ewCredentialBody,
} from '@/tools/agiloft/utils'
import { executeEwRequest } from '@/tools/agiloft/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftSelectRecordsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Agiloft select_records attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      agiloftSelectRecordsContract,
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

    const result = await executeEwRequest<AgiloftSelectResponse>(
      params,
      (base) => ({
        url: buildSelectRecordsUrl(base, params),
        /**
         * POST with the credentials in the body: EWSelect is one of the five
         * operations that support it, and it keeps the password out of the URL
         * and out of the server's access logs.
         */
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: ewCredentialBody(params),
      }),
      async (response) => {
        const body = await response.text()

        if (!response.ok) {
          return {
            success: false,
            output: { recordIds: [], totalCount: 0, truncated: false },
            error: `Agiloft error ${response.status}: ${describeAgiloftError(body)}`,
          }
        }

        /**
         * EWSelect answers with EWREST_id_length followed by one EWREST_id_<n>
         * assignment per match, and zero matches still yields the length line.
         * A body with no assignments at all is therefore never a legitimate
         * empty result — it is a refusal Agiloft returned with HTTP 200, most
         * often invalid WHERE-clause SQL.
         */
        const values = parseEwRest(body)
        if (values.size === 0) {
          return {
            success: false,
            output: { recordIds: [], totalCount: 0, truncated: false },
            error: `Agiloft did not return a result set: ${body.trim() || '(empty response)'}`,
          }
        }

        const { recordIds } = toRecordIds(values)
        const capped = recordIds.slice(0, AGILOFT_MAX_SELECT_IDS)

        if (recordIds.length > capped.length) {
          logger.warn(
            `[${requestId}] Agiloft select returned ${recordIds.length} IDs; truncated to ${AGILOFT_MAX_SELECT_IDS}`,
            { table: params.table }
          )
        }

        return {
          success: true,
          output: {
            recordIds: capped,
            totalCount: capped.length,
            truncated: recordIds.length > capped.length,
          },
        }
      }
    )

    return NextResponse.json(result)
  } catch (error) {
    logger.error(`[${requestId}] Error selecting Agiloft records:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
