import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftCreateRecordContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { parseEwRest } from '@/tools/agiloft/ewrest'
import type { AgiloftRecordResponse } from '@/tools/agiloft/types'
import {
  buildCreateRecordBody,
  buildCreateRecordUrl,
  describeAgiloftError,
  redactAgiloftSecrets,
} from '@/tools/agiloft/utils'
import { executeEwRequest, resolveAgiloftInstance } from '@/tools/agiloft/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftCreateRecordAPI')

/**
 * Opens every failure where the write may already have committed. The caller
 * has to be told not to retry blindly: a second create writes a second record
 * rather than recovering the first.
 */
const UNCONFIRMED_PREFIX =
  'The create could not be confirmed, so the record may exist. Check the table before retrying - retrying creates a second record.'

/** A typed Agiloft exception means the create was declined, not left in doubt. */
const AGILOFT_EXCEPTION = /EW[A-Za-z]*Exception/

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Agiloft create_record attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      agiloftCreateRecordContract,
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

    let fieldValues: Record<string, unknown>
    try {
      const parsedData = JSON.parse(params.data)
      if (typeof parsedData !== 'object' || parsedData === null || Array.isArray(parsedData)) {
        throw new Error('not an object')
      }
      fieldValues = parsedData as Record<string, unknown>
    } catch {
      return NextResponse.json({
        success: false,
        output: { id: null, fields: {} },
        error: 'The data parameter must be a JSON object of field names to values',
      })
    }

    /**
     * Encoded before the request is issued, not inside the request builder: an
     * unencodable field is a permanent refusal, and a TypeError thrown from the
     * builder would surface as a 500 the tool runner then retries.
     */
    let requestBody: string
    try {
      requestBody = buildCreateRecordBody(params, fieldValues)
    } catch (error) {
      return NextResponse.json({
        success: false,
        output: { id: null, fields: {} },
        error: getErrorMessage(error, 'The data parameter contains a value Agiloft cannot encode'),
      })
    }

    /**
     * Resolved here rather than only inside the executor so a rejected instance
     * URL stays a pre-flight failure. Everything thrown after this point has to
     * be treated as "the request may have been transmitted".
     */
    let resolvedIP: string
    try {
      resolvedIP = await resolveAgiloftInstance(params.instanceUrl)
    } catch (error) {
      logger.warn(`[${requestId}] Rejected Agiloft instance URL`, { error })
      return NextResponse.json(
        { success: false, output: { id: null, fields: {} }, error: toError(error).message },
        { status: 400 }
      )
    }

    let result: AgiloftRecordResponse
    try {
      result = await executeEwRequest<AgiloftRecordResponse>(
        params,
        (base) => ({
          url: buildCreateRecordUrl(base),
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: requestBody,
        }),
        async (response) => {
          const text = await response.text()
          /**
           * Redacted here, not at each use: every branch below relays this text,
           * and the credentials are in the submitted form body, so an error page
           * that echoes request parameters would carry them back.
           */
          const described = truncate(redactAgiloftSecrets(describeAgiloftError(text), params), 300)

          /**
           * Every failure below is one Agiloft already decided on, so each is
           * reported in a 200 body with `success: false`. A non-2xx status would
           * make the tool runner retry, and a retried create writes a second
           * record rather than converging on the first.
           */
          if (!response.ok) {
            /**
             * A 4xx carrying a typed exception is Agiloft validating the request
             * and declining it, so nothing was written and a corrected retry is
             * safe. A 5xx is a server fault that may have committed first, so it
             * keeps the unconfirmed warning whatever the body says.
             */
            const declined = response.status < 500 && AGILOFT_EXCEPTION.test(described)
            return {
              success: false,
              output: { id: null, fields: {} },
              error: declined
                ? `Agiloft refused the create, so no record was written: ${described}`
                : `${UNCONFIRMED_PREFIX} Agiloft answered ${response.status}: ${described}`,
            }
          }

          const values = parseEwRest(text)
          const id = values.get('id')

          /**
           * A typed exception in the body is Agiloft declining the create, so
           * nothing was written and a corrected retry is safe. Only an
           * unexplained missing ID leaves the write in doubt.
           */
          if (!id) {
            const declined = AGILOFT_EXCEPTION.test(described)
            logger.error(`[${requestId}] Agiloft create returned no record ID`, {
              table: params.table,
              login: params.login,
              fields: Object.keys(fieldValues),
              declined,
            })
            return {
              success: false,
              output: { id: null, fields: {} },
              error: declined
                ? `Agiloft refused the create, so no record was written: ${described}`
                : `${UNCONFIRMED_PREFIX} Agiloft accepted the create but returned no record ID: ${described}`,
            }
          }

          /**
           * The ID is chained straight into reads, updates, and deletes, and the
           * response format is unescaped text, so a value that is not a plain
           * record ID is refused rather than passed downstream.
           */
          if (!/^\d+$/.test(id)) {
            logger.error(`[${requestId}] Agiloft create returned a non-numeric record ID`, {
              table: params.table,
            })
            return {
              success: false,
              output: { id: null, fields: {} },
              error: `${UNCONFIRMED_PREFIX} Agiloft returned a record ID that is not a number.`,
            }
          }

          /**
           * EWCreate documents only the ID, but any other assignment it returns is
           * a field value on the new record, so it is passed through rather than
           * dropped. Usually empty.
           */
          const fields: Record<string, unknown> = {}
          for (const [key, value] of values) {
            if (key !== 'id') fields[key] = value
          }

          return { success: true, output: { id, fields } }
        },
        resolvedIP
      )
    } catch (error) {
      /**
       * The request was already on the wire when this threw — a timeout, a
       * reset, a refused redirect, an oversized body. The write may have
       * committed, so this is a settled failure carrying the same warning. A
       * 500 is what would have the caller retry and duplicate the record, which
       * is the failure this operation exists to prevent.
       */
      logger.error(`[${requestId}] Agiloft create failed after the request was sent`, {
        error,
        table: params.table,
        login: params.login,
      })

      return NextResponse.json({
        success: false,
        output: { id: null, fields: {} },
        error: `${UNCONFIRMED_PREFIX} ${redactAgiloftSecrets(toError(error).message, params)}`,
      })
    }

    return NextResponse.json(result)
  } catch (error) {
    logger.error(`[${requestId}] Error creating Agiloft record:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
