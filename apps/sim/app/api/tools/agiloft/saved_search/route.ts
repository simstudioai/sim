import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftSavedSearchContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { AgiloftSavedSearchResponse } from '@/tools/agiloft/types'
import { buildSavedSearchUrl } from '@/tools/agiloft/utils'
import {
  executeAgiloftRequest,
  isAgiloftRefusal,
  readAlrestJson,
} from '@/tools/agiloft/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftSavedSearchAPI')

interface SavedSearchRow {
  name?: string
  label?: string
  id?: number
  description?: string
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Agiloft saved_search attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      agiloftSavedSearchContract,
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

    /**
     * EWSavedSearch must run under EWLogin or OAuth authorization, so this goes
     * through the token-bearing executor rather than the inline-credential one
     * the other legacy operations use.
     */
    const result = await executeAgiloftRequest<AgiloftSavedSearchResponse>(
      params,
      (base) => ({
        url: buildSavedSearchUrl(base, params),
        method: 'GET',
        headers: { Accept: 'application/json' },
      }),
      async (response) => {
        const rows = (await readAlrestJson<SavedSearchRow[]>(response)) ?? []

        const searches = rows.map((row) => ({
          name: row.name ?? '',
          label: row.label ?? row.name ?? '',
          id: row.id ?? null,
          description: row.description ?? null,
        }))

        return { success: true, output: { searches, totalCount: searches.length } }
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
        output: { searches: [], totalCount: 0 },
        error: error.message,
      })
    }

    logger.error(`[${requestId}] Error listing Agiloft saved searches:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
