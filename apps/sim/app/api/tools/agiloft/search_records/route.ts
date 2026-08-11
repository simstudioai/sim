import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { filterUndefined } from '@sim/utils/object'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftSearchRecordsContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { AgiloftSearchResponse } from '@/tools/agiloft/types'
import { AGILOFT_MAX_SEARCH_RECORDS, alrestSearchUrl, parseFieldList } from '@/tools/agiloft/utils'
import {
  executeAlrestRequest,
  isAgiloftRefusal,
  readAlrestJson,
} from '@/tools/agiloft/utils.server'

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

    const page = params.page ? Number(params.page) : 0
    const limit = params.limit ? Number(params.limit) : 0

    const result = await executeAlrestRequest<AgiloftSearchResponse>(
      params,
      (base) => ({
        url: alrestSearchUrl(base, params.table),
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(
          filterUndefined({
            search: params.search?.trim() || undefined,
            query: params.query?.trim() || undefined,
            field: parseFieldList(params.fields),
            page: params.page ? page : undefined,
            limit: params.limit ? limit : undefined,
          })
        ),
      }),
      async (response) => {
        const returned = (await readAlrestJson<Record<string, unknown>[]>(response)) ?? []
        const records = returned.slice(0, AGILOFT_MAX_SEARCH_RECORDS)

        if (returned.length > records.length) {
          logger.warn(
            `[${requestId}] Agiloft search returned ${returned.length} records; truncated to ${AGILOFT_MAX_SEARCH_RECORDS}`,
            { table: params.table }
          )
        }

        return {
          success: true,
          output: {
            records,
            totalCount: records.length,
            page,
            limit,
            truncated: returned.length > records.length,
          },
        }
      }
    )

    return NextResponse.json(result)
  } catch (error) {
    /**
     * A refusal Agiloft already decided on is a final answer, not a transient
     * fault — returning 500 would make the tool runner retry it.
     */
    if (isAgiloftRefusal(error)) {
      logger.warn(`[${requestId}] Agiloft refused the request`, { error: error.message })
      return NextResponse.json({
        success: false,
        output: { records: [], totalCount: 0, page: 0, limit: 0, truncated: false },
        error: error.message,
      })
    }

    logger.error(`[${requestId}] Error searching Agiloft records:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
