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
import { buildGetChoiceLineIdUrl, describeAgiloftError } from '@/tools/agiloft/utils'
import { executeEwRequest } from '@/tools/agiloft/utils.server'

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

    const result = await executeEwRequest<AgiloftGetChoiceLineIdResponse>(
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
            error: `Agiloft error ${response.status}: ${describeAgiloftError(body)}`,
          }
        }

        /** Documented response: EWREST_choiceLineId = '1'; */
        const raw = parseEwRest(body).get('choiceLineId')
        const parsedId = Number(raw)
        const choiceLineId =
          raw !== undefined && raw.trim() !== '' && Number.isFinite(parsedId) ? parsedId : null

        if (raw === undefined) {
          return {
            success: false,
            output: { choiceLineId: null },
            error: `Agiloft did not return a choice line ID for "${params.value}" in field "${params.fieldName}": ${body.trim() || '(empty response)'}`,
          }
        }

        if (choiceLineId === null) {
          return {
            success: false,
            output: { choiceLineId: null },
            error: `Agiloft returned a non-numeric choice line ID for "${params.value}" in field "${params.fieldName}": "${raw}"`,
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
