import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftRemoveAttachmentContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { parseEwRest } from '@/tools/agiloft/ewrest'
import type { AgiloftRemoveAttachmentResponse } from '@/tools/agiloft/types'
import { buildRemoveAttachmentUrl, describeAgiloftError } from '@/tools/agiloft/utils'
import { executeEwRequest } from '@/tools/agiloft/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftRemoveAttachmentAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(
        `[${requestId}] Unauthorized Agiloft remove_attachment attempt: ${authResult.error}`
      )
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      agiloftRemoveAttachmentContract,
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

    const result = await executeEwRequest<AgiloftRemoveAttachmentResponse>(
      params,
      (base) => ({
        url: buildRemoveAttachmentUrl(base, params),
        /** EWRemoveAttachment is a GET/POST operation; it does not accept DELETE. */
        method: 'GET',
      }),
      async (response) => {
        const text = await response.text()

        if (!response.ok) {
          return {
            success: false,
            output: {
              recordId: params.recordId?.trim() ?? '',
              fieldName: params.fieldName?.trim() ?? '',
              remainingAttachments: 0,
            },
            error: `Agiloft error ${response.status}: ${describeAgiloftError(text)}`,
          }
        }

        /**
         * The URL carries no `.json` decorator, so the body is the EWREST
         * assignment form — `EWREST_<fieldName>.length='0';` — exactly as
         * EWAttach returns. Parsing it as JSON silently produced 0 on every
         * call regardless of what Agiloft reported.
         */
        const fieldName = params.fieldName.trim()
        const assignments = parseEwRest(text)
        const countRaw = assignments.get(`${fieldName}.length`) ?? [...assignments.values()][0]
        const remainingAttachments = Number(countRaw)

        if (!Number.isFinite(remainingAttachments)) {
          return {
            success: false,
            output: { recordId: params.recordId.trim(), fieldName, remainingAttachments: 0 },
            error: `Agiloft did not report the remaining attachment count: ${text.trim() || '(empty response)'}`,
          }
        }

        return {
          success: true,
          output: {
            recordId: params.recordId.trim(),
            fieldName,
            remainingAttachments,
          },
        }
      }
    )

    return NextResponse.json(result)
  } catch (error) {
    logger.error(`[${requestId}] Error removing Agiloft attachment:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
