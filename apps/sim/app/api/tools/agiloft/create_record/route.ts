import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftCreateRecordContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { parseEwRest, toRecord } from '@/tools/agiloft/ewrest'
import type { AgiloftRecordResponse } from '@/tools/agiloft/types'
import { buildCreateRecordUrl } from '@/tools/agiloft/utils'
import { executeAgiloftRequest } from '@/tools/agiloft/utils.server'

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

    const result = await executeAgiloftRequest<AgiloftRecordResponse>(
      params,
      (base) => ({
        url: buildCreateRecordUrl(base, params, fieldValues),
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
      async (response) => {
        const body = await response.text()

        if (!response.ok) {
          return {
            success: false,
            output: { id: null, fields: {} },
            error: `Agiloft error: ${response.status} - ${body}`,
          }
        }

        /** EWCreate answers with a single assignment: EWREST_id='353'; */
        const { id, fields } = toRecord(parseEwRest(body))

        if (id === null) {
          return {
            success: false,
            output: { id: null, fields },
            error: `Agiloft did not return a record ID: ${body.trim() || '(empty response)'}`,
          }
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
