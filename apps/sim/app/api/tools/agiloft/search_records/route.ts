import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftSearchRecordsContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { parseEwRest, toSearchRecords } from '@/tools/agiloft/ewrest'
import type { AgiloftSearchResponse } from '@/tools/agiloft/types'
import { buildSearchRecordsUrl } from '@/tools/agiloft/utils'
import { executeAgiloftRequest } from '@/tools/agiloft/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftSearchRecordsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Agiloft search_records attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      agiloftSearchRecordsContract,
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

    const result = await executeAgiloftRequest<AgiloftSearchResponse>(
      params,
      (base) => ({
        url: buildSearchRecordsUrl(base, params),
        method: 'GET',
      }),
      async (response) => {
        const body = await response.text()
        const page = params.page ? Number(params.page) : 0
        const limit = params.limit ? Number(params.limit) : 0

        if (!response.ok) {
          return {
            success: false,
            output: { records: [], totalCount: 0, page, limit },
            error: `Agiloft error: ${response.status} - ${body}`,
          }
        }

        /**
         * EWSearch answers with EWREST_length plus one EWREST_<field>_<index>
         * assignment per field per row, and reports an empty result set as
         * EWREST_id_length = '0'. A body with no assignments at all is therefore
         * never a legitimate empty search — it is a refusal Agiloft returned
         * with HTTP 200, such as an invalid query or an unknown saved search.
         */
        const values = parseEwRest(body)
        if (values.size === 0) {
          return {
            success: false,
            output: { records: [], totalCount: 0, page, limit },
            error: `Agiloft did not return search results: ${body.trim() || '(empty response)'}`,
          }
        }

        const { records, count } = toSearchRecords(values)

        return {
          success: true,
          output: { records, totalCount: count, page, limit },
        }
      }
    )

    return NextResponse.json(result)
  } catch (error) {
    logger.error(`[${requestId}] Error searching Agiloft records:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
