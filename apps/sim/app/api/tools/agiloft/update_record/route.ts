import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftUpdateRecordContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { AgiloftRecordResponse } from '@/tools/agiloft/types'
import { alrestRecordUrl } from '@/tools/agiloft/utils'
import {
  executeAlrestRequest,
  isAgiloftRefusal,
  readAlrestJson,
} from '@/tools/agiloft/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftUpdateRecordAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Agiloft update_record attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      agiloftUpdateRecordContract,
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

    const result = await executeAlrestRequest<AgiloftRecordResponse>(
      params,
      (base) => ({
        url: alrestRecordUrl(base, params.table, params.recordId),
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(fieldValues),
      }),
      async (response) => {
        const record = await readAlrestJson<Record<string, unknown>>(response)
        const id = record?.id ?? params.recordId.trim()

        return {
          success: true,
          output: { id: String(id), fields: record ?? {} },
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
        output: { id: null, fields: {} },
        error: error.message,
      })
    }

    logger.error(`[${requestId}] Error updating Agiloft record:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
