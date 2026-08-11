import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftReadRecordContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { parseEwRest, toRecord } from '@/tools/agiloft/ewrest'
import type { AgiloftRecordResponse } from '@/tools/agiloft/types'
import { buildReadRecordUrl } from '@/tools/agiloft/utils'
import { executeAgiloftRequest } from '@/tools/agiloft/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftReadRecordAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Agiloft read_record attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      agiloftReadRecordContract,
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
     * EWRead has no documented field-selection parameter — it returns the whole
     * record the caller is permitted to see — so the requested subset is
     * applied here rather than sent upstream.
     */
    const requestedFields = params.fields
      ?.split(',')
      .map((field) => field.trim())
      .filter(Boolean)

    const result = await executeAgiloftRequest<AgiloftRecordResponse>(
      params,
      (base) => ({
        url: buildReadRecordUrl(base, params),
        method: 'GET',
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

        const values = parseEwRest(body)
        if (values.size === 0) {
          return {
            success: false,
            output: { id: null, fields: {} },
            error: `Agiloft returned no record data: ${body.trim() || '(empty response)'}`,
          }
        }

        const { id, fields } = toRecord(values)

        if (!requestedFields?.length) {
          return { success: true, output: { id, fields } }
        }

        const selected: Record<string, string> = {}
        for (const field of requestedFields) {
          if (field in fields) selected[field] = fields[field]
        }
        return { success: true, output: { id, fields: selected } }
      }
    )

    return NextResponse.json(result)
  } catch (error) {
    logger.error(`[${requestId}] Error reading Agiloft record:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
