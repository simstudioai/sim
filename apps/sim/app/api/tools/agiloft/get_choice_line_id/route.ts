import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftGetChoiceLineIdContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { AgiloftGetChoiceLineIdResponse } from '@/tools/agiloft/types'
import { buildGetChoiceLineIdUrl } from '@/tools/agiloft/utils'
import { executeAgiloftRequest } from '@/tools/agiloft/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftGetChoiceLineIdAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(
        `[${requestId}] Unauthorized Agiloft get_choice_line_id attempt: ${authResult.error}`
      )
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      agiloftGetChoiceLineIdContract,
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

    const result = await executeAgiloftRequest<AgiloftGetChoiceLineIdResponse>(
      params,
      (base) => ({
        url: buildGetChoiceLineIdUrl(base, params),
        method: 'GET',
        headers: { Accept: 'application/json' },
      }),
      async (response) => {
        if (!response.ok) {
          const errorText = await response.text()
          return {
            success: false,
            output: { choiceLineId: null },
            error: `Agiloft error: ${response.status} - ${errorText}`,
          }
        }

        const data = (await response.json()) as Record<string, unknown>
        const result = data.result ?? data
        let choiceLineId: number | null = null

        if (typeof result === 'number') {
          choiceLineId = result
        } else if (typeof result === 'string') {
          const parsed = Number(result)
          choiceLineId = Number.isFinite(parsed) ? parsed : null
        } else if (typeof result === 'object' && result !== null) {
          const obj = result as Record<string, unknown>
          const idVal = obj.id ?? obj.choiceLineId ?? obj.lineId
          if (typeof idVal === 'number') {
            choiceLineId = idVal
          } else if (typeof idVal === 'string') {
            const parsed = Number(idVal)
            choiceLineId = Number.isFinite(parsed) ? parsed : null
          }
        }

        if (choiceLineId === null) {
          return {
            success: false,
            output: { choiceLineId: null },
            error: `No choice line ID found for value "${params.value}" in field "${params.fieldName}"`,
          }
        }

        return {
          success: data.success !== false,
          output: { choiceLineId },
        }
      }
    )

    return NextResponse.json(result)
  } catch (error) {
    logger.error(`[${requestId}] Error getting Agiloft choice line ID:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
