import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftLockRecordContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { AgiloftLockResponse } from '@/tools/agiloft/types'
import { buildLockRecordUrl, getLockHttpMethod } from '@/tools/agiloft/utils'
import { executeAgiloftRequest } from '@/tools/agiloft/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftLockRecordAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Agiloft lock_record attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      agiloftLockRecordContract,
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

    const result = await executeAgiloftRequest<AgiloftLockResponse>(
      params,
      (base) => ({
        url: buildLockRecordUrl(base, params),
        method: getLockHttpMethod(params.lockAction),
      }),
      async (response) => {
        if (!response.ok) {
          const errorText = await response.text()
          return {
            success: false,
            output: {
              id: params.recordId?.trim() ?? '',
              lockStatus: 'UNKNOWN',
              lockedBy: null,
              lockExpiresInMinutes: null,
            },
            error: `Agiloft error: ${response.status} - ${errorText}`,
          }
        }

        const data = (await response.json()) as Record<string, unknown>
        const result = (data.result ?? data) as Record<string, unknown>

        return {
          success: data.success !== false,
          output: {
            id: String(result.id ?? params.recordId?.trim() ?? ''),
            lockStatus:
              (result.lock_status as string) ?? (result.lockStatus as string) ?? 'UNKNOWN',
            lockedBy:
              (result.locked_by as string | null) ?? (result.lockedBy as string | null) ?? null,
            lockExpiresInMinutes:
              (result.lock_expires_in_minutes as number | null) ??
              (result.lockExpiresInMinutes as number | null) ??
              null,
          },
        }
      }
    )

    return NextResponse.json(result)
  } catch (error) {
    logger.error(`[${requestId}] Error locking Agiloft record:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
