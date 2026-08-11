import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftGetChoiceLineIdContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { parseEwRest } from '@/tools/agiloft/ewrest'
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
      }),
      async (response) => {
        const body = await response.text()

        if (!response.ok) {
          return {
            success: false,
            output: { choiceLineId: null },
            error: `Agiloft error: ${response.status} - ${body}`,
          }
        }

        /**
         * The docs state only that EWGetChoiceLineId "returns the ID of the
         * choice list element" without naming the assignment key, so the first
         * numeric EWREST_ value is taken rather than guessing a key name.
         */
        let choiceLineId: number | null = null
        for (const value of parseEwRest(body).values()) {
          const parsedValue = Number(value)
          if (value.trim() !== '' && Number.isFinite(parsedValue)) {
            choiceLineId = parsedValue
            break
          }
        }

        if (choiceLineId === null) {
          return {
            success: false,
            output: { choiceLineId: null },
            error: `No choice line ID found for value "${params.value}" in field "${params.fieldName}": ${body.trim() || '(empty response)'}`,
          }
        }

        return { success: true, output: { choiceLineId } }
      }
    )

    return NextResponse.json(result)
  } catch (error) {
    logger.error(`[${requestId}] Error getting Agiloft choice line ID:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
