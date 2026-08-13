import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftNlpSearchContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { AgiloftNlpSearchResponse } from '@/tools/agiloft/types'
import {
  AGILOFT_MAX_SEARCH_RECORDS,
  buildNlpSearchBody,
  buildNlpSearchUrl,
  redactAgiloftSecrets,
} from '@/tools/agiloft/utils'
import { executeEwRequest, isAgiloftRefusal, readAlrestJson } from '@/tools/agiloft/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftNlpSearchAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  /**
   * Captured for the outer catch, which sits outside the scope the parsed body
   * lives in. Anything relayed from there can still carry upstream text, and
   * these operations put the credentials on the request itself.
   */
  let credentials: { login: string; password: string } | undefined

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
    credentials = params

    let result: AgiloftNlpSearchResponse
    try {
      result = await executeEwRequest<AgiloftNlpSearchResponse>(
        params,
        (base) => ({
          url: buildNlpSearchUrl(base),
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: buildNlpSearchBody(params),
        }),
        async (response) => {
          /**
           * EWNLPSearch is the one legacy `EW*` operation that answers in the JSON
           * envelope the `alrest` surface uses — `{success, message, result}` with
           * `result` as the record array — rather than `EWREST_` assignments. Its
           * request half is form-encoded like the rest of the `EW*` surface, so
           * the two halves deliberately use different conventions. Do not
           * "correct" this to `parseEwRest` to match create.
           */
          const payload = await readAlrestJson<Record<string, unknown>[]>(response, params)

          /**
           * `result` is documented as an array, but a single-record or empty-object
           * answer would make an unchecked `.slice` throw a TypeError that escapes
           * as a 500. Normalising keeps an unexpected shape a readable result.
           */
          const returned = Array.isArray(payload) ? payload : payload ? [payload] : []
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
    } catch (error) {
      /**
       * A refusal Agiloft already decided on is a final answer, not a transient
       * fault, so it is reported in a 200 body like every sibling operation does.
       * A 500 would have the tool runner retry a search Agiloft has already
       * declined. The message carries upstream response text and this request's
       * credentials travel in its form body, so it is redacted first.
       */
      if (isAgiloftRefusal(error)) {
        const described = redactAgiloftSecrets(error.message, params)
        logger.warn(`[${requestId}] Agiloft refused the request`, { error: described })
        return NextResponse.json({
          success: false,
          output: { records: [], totalCount: 0, truncated: false },
          error: described,
        })
      }

      const described = redactAgiloftSecrets(toError(error).message, params)
      logger.error(`[${requestId}] Error running Agiloft NLP search`, { error: described })
      return NextResponse.json({ success: false, error: described }, { status: 500 })
    }

    return NextResponse.json(result)
  } catch (error) {
    const described = credentials
      ? redactAgiloftSecrets(toError(error).message, credentials)
      : toError(error).message
    logger.error(`[${requestId}] Error running Agiloft NLP search`, { error: described })

    return NextResponse.json({ success: false, error: described }, { status: 500 })
  }
})
