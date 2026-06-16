import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftAttachmentInfoContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { AgiloftAttachmentInfoResponse } from '@/tools/agiloft/types'
import { buildAttachmentInfoUrl } from '@/tools/agiloft/utils'
import { executeAgiloftRequest } from '@/tools/agiloft/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftAttachmentInfoAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(
        `[${requestId}] Unauthorized Agiloft attachment_info attempt: ${authResult.error}`
      )
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      agiloftAttachmentInfoContract,
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

    const result = await executeAgiloftRequest<AgiloftAttachmentInfoResponse>(
      params,
      (base) => ({
        url: buildAttachmentInfoUrl(base, params),
        method: 'GET',
      }),
      async (response) => {
        if (!response.ok) {
          const errorText = await response.text()
          return {
            success: false,
            output: { attachments: [], totalCount: 0 },
            error: `Agiloft error: ${response.status} - ${errorText}`,
          }
        }

        const data = (await response.json()) as Record<string, unknown>
        const result = (data.result ?? data) as Record<string, unknown>

        const attachments: Array<{ position: number; name: string; size: number }> = []

        if (Array.isArray(result)) {
          for (let i = 0; i < result.length; i++) {
            const item = result[i] as Record<string, unknown>
            attachments.push({
              position: (item.filePosition as number) ?? (item.position as number) ?? i,
              name:
                (item.fileName as string) ??
                (item.name as string) ??
                (item.filename as string) ??
                '',
              size: (item.size as number) ?? (item.fileSize as number) ?? 0,
            })
          }
        }

        return {
          success: data.success !== false,
          output: {
            attachments,
            totalCount: attachments.length,
          },
        }
      }
    )

    return NextResponse.json(result)
  } catch (error) {
    logger.error(`[${requestId}] Error getting Agiloft attachment info:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
