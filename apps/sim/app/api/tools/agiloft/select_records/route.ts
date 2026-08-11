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
import { buildSelectRecordsUrl } from '@/tools/agiloft/utils'
import { executeAgiloftRequest } from '@/tools/agiloft/utils.server'

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

    const result = await executeAgiloftRequest<AgiloftSelectResponse>(
      params,
      (base) => ({
        url: buildSelectRecordsUrl(base, params),
        method: 'GET',
      }),
      async (response) => {
        const body = await response.text()

        if (!response.ok) {
          return {
            success: false,
            output: { recordIds: [], totalCount: 0 },
            error: `Agiloft error: ${response.status} - ${body}`,
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
            output: { recordIds: [], totalCount: 0 },
            error: `Agiloft did not return a result set: ${body.trim() || '(empty response)'}`,
          }
        }

        const { recordIds, count } = toRecordIds(values)

        return { success: true, output: { recordIds, totalCount: count } }
      }
    )

    return NextResponse.json(result)
  } catch (error) {
    logger.error(`[${requestId}] Error selecting Agiloft records:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
