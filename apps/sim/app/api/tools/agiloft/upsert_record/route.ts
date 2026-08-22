import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftUpsertRecordContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { parseEwRest } from '@/tools/agiloft/ewrest'
import type { AgiloftUpsertRecordResponse } from '@/tools/agiloft/types'
import {
  buildUpsertRecordBody,
  buildUpsertRecordUrl,
  describeAgiloftError,
} from '@/tools/agiloft/utils'
import { executeEwRequest } from '@/tools/agiloft/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftUpsertRecordAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Agiloft upsert_record attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      agiloftUpsertRecordContract,
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
        output: { id: null, created: false, callbackId: null },
        error: 'The data parameter must be a JSON object of field names to values',
      })
    }

    let body: string
    try {
      body = buildUpsertRecordBody(params, fieldValues)
    } catch (error) {
      return NextResponse.json({
        success: false,
        output: { id: null, created: false, callbackId: null },
        error: toError(error).message,
      })
    }

    const result = await executeEwRequest<AgiloftUpsertRecordResponse>(
      params,
      (base) => ({
        url: buildUpsertRecordUrl(base),
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      }),
      async (response) => {
        const body = await response.text()

        /** 409 means the match criteria selected more than one record. */
        if (response.status === 409) {
          return {
            success: false,
            output: { id: null, created: false, callbackId: null },
            error: `Agiloft found more than one record matching "${params.match}", so it did not write: ${body.trim()}`,
          }
        }

        if (!response.ok) {
          return {
            success: false,
            output: { id: null, created: false, callbackId: null },
            error: `Agiloft error ${response.status}: ${describeAgiloftError(body)}`,
          }
        }

        /**
         * 202 is the documented acknowledgement for an asynchronous upsert. It
         * carries no record ID, so it must not be read as a failed write.
         */
        if (response.status === 202) {
          const callbackId = parseEwRest(body).get('EWCALLBACK_ID') ?? null

          if (!callbackId) {
            logger.warn(
              `[${requestId}] Agiloft queued the upsert without a callback ID; the result cannot be polled`,
              { body: body.slice(0, 200) }
            )
          }

          return { success: true, output: { id: null, created: false, callbackId } }
        }

        /** Documented response: EWREST_id='353'; with 201 on create, 200 on update. */
        const id = parseEwRest(body).get('id')

        if (id === undefined) {
          return {
            success: false,
            output: { id: null, created: false, callbackId: null },
            error: `Agiloft did not return a record ID: ${body.trim() || '(empty response)'}`,
          }
        }

        return { success: true, output: { id, created: response.status === 201, callbackId: null } }
      }
    )

    return NextResponse.json(result)
  } catch (error) {
    logger.error(`[${requestId}] Error upserting Agiloft record:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
