import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftUpdateRecordContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { AgiloftRecordResponse } from '@/tools/agiloft/types'
import { buildUpdateRecordUrl } from '@/tools/agiloft/utils'
import { executeAgiloftRequest } from '@/tools/agiloft/utils.server'

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

    let body: string
    try {
      body = JSON.stringify(JSON.parse(params.data))
    } catch {
      return NextResponse.json({
        success: false,
        output: { id: null, fields: {} },
        error: 'Invalid JSON in data parameter',
      })
    }

    const result = await executeAgiloftRequest<AgiloftRecordResponse>(
      params,
      (base) => ({
        url: buildUpdateRecordUrl(base, params),
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body,
      }),
      async (response) => {
        if (!response.ok) {
          const errorText = await response.text()
          return {
            success: false,
            output: { id: null, fields: {} },
            error: `Agiloft error: ${response.status} - ${errorText}`,
          }
        }

        const data = (await response.json()) as Record<string, unknown>
        const result = (data.result ?? data) as Record<string, unknown>
        const id = result.id ?? result.ID ?? data.id ?? data.ID ?? null

        return {
          success: data.success !== false,
          output: {
            id: id != null ? String(id) : null,
            fields: result ?? {},
          },
        }
      }
    )

    return NextResponse.json(result)
  } catch (error) {
    logger.error(`[${requestId}] Error updating Agiloft record:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
