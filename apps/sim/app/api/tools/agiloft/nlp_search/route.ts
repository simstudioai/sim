import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { filterUndefined } from '@sim/utils/object'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftNlpSearchContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { AgiloftNlpSearchResponse } from '@/tools/agiloft/types'
import {
  AGILOFT_LANG,
  AGILOFT_MAX_SEARCH_RECORDS,
  buildNlpSearchUrl,
  parseFieldList,
} from '@/tools/agiloft/utils'
import { executeEwRequest, readAlrestJson } from '@/tools/agiloft/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftNlpSearchAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Agiloft nlp_search attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      agiloftNlpSearchContract,
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

    const result = await executeEwRequest<AgiloftNlpSearchResponse>(
      params,
      (base) => ({
        url: buildNlpSearchUrl(base),
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        /**
         * EWNLPSearch accepts application/json, so credentials travel in the
         * body rather than the query string.
         */
        body: JSON.stringify(
          filterUndefined({
            $KB: params.knowledgeBase,
            $login: params.login,
            $password: params.password,
            $lang: AGILOFT_LANG,
            field: parseFieldList(params.fields),
            nlp_query: params.nlpQuery.trim(),
            page: params.page ? Number(params.page) : undefined,
            limit: params.limit ? Number(params.limit) : undefined,
          })
        ),
      }),
      async (response) => {
        const returned = (await readAlrestJson<Record<string, unknown>[]>(response)) ?? []
        const records = returned.slice(0, AGILOFT_MAX_SEARCH_RECORDS)

        if (returned.length > records.length) {
          logger.warn(
            `[${requestId}] Agiloft NLP search returned ${returned.length} records; truncated to ${AGILOFT_MAX_SEARCH_RECORDS}`
          )
        }

        return {
          success: true,
          output: {
            records,
            totalCount: records.length,
            truncated: returned.length > records.length,
          },
        }
      }
    )

    return NextResponse.json(result)
  } catch (error) {
    logger.error(`[${requestId}] Error running Agiloft NLP search:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
