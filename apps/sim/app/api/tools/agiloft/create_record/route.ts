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
} from '@/tools/agiloft/utils'
import { executeEwRequest } from '@/tools/agiloft/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftCreateRecordAPI')

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

    const result = await executeEwRequest<AgiloftRecordResponse>(
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
         * Every failure below is one Agiloft already decided on, so each is
         * reported in a 200 body with `success: false`. A non-2xx status would
         * make the tool runner retry, and a retried create writes a second
         * record rather than converging on the first.
         */
        if (!response.ok) {
          return {
            success: false,
            output: { id: null, fields: {} },
            error: `Agiloft error ${response.status}: ${describeAgiloftError(truncate(text, 300))}`,
          }
        }

        const values = parseEwRest(text)
        const id = values.get('id')

        /**
         * EWCreate publishes the new record's ID as `EWREST_id`. Reaching this
         * branch means the write may well have landed while the ID did not come
         * back, so the caller is told not to retry blindly: a second attempt
         * would create a duplicate rather than recover the first record.
         */
        if (!id) {
          logger.error(`[${requestId}] Agiloft create returned no record ID`, {
            table: params.table,
          })
          return {
            success: false,
            output: { id: null, fields: {} },
            error: `Agiloft accepted the create but returned no record ID, so the record may exist. Check the table before retrying - retrying creates a second record. Response: ${describeAgiloftError(truncate(text, 300))}`,
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
      }
    )

    return NextResponse.json(result)
  } catch (error) {
    logger.error(`[${requestId}] Error creating Agiloft record:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
