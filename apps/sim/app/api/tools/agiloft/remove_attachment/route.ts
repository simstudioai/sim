import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftRemoveAttachmentContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { AgiloftRemoveAttachmentResponse } from '@/tools/agiloft/types'
import { buildRemoveAttachmentUrl } from '@/tools/agiloft/utils'
import { executeAgiloftRequest } from '@/tools/agiloft/utils.server'

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

    const result = await executeAgiloftRequest<AgiloftRemoveAttachmentResponse>(
      params,
      (base) => ({
        url: buildRemoveAttachmentUrl(base, params),
        method: 'DELETE',
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
            error: `Agiloft error: ${response.status} - ${text}`,
          }
        }

        let remainingAttachments = 0
        try {
          const data = JSON.parse(text)
          const result = data.result ?? data
          remainingAttachments =
            typeof result === 'number' ? result : (result.count ?? result.remaining ?? 0)
        } catch {
          remainingAttachments = Number(text) || 0
        }

        return {
          success: true,
          output: {
            recordId: params.recordId?.trim() ?? '',
            fieldName: params.fieldName?.trim() ?? '',
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
