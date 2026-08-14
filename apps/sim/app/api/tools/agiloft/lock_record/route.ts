import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftLockRecordContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { AgiloftLockResponse } from '@/tools/agiloft/types'
import { buildLockRecordUrl, describeAgiloftError, getLockHttpMethod } from '@/tools/agiloft/utils'
import { executeEwRequest } from '@/tools/agiloft/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftLockRecordAPI')

/** Lock output for a call that never returned a lock state. */
function emptyLock(recordId: string) {
  return {
    id: recordId.trim(),
    tableId: null,
    lockStatus: '',
    lockedBy: null,
    lockExpiresInMinutes: null,
  }
}

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

    const result = await executeEwRequest<AgiloftLockResponse>(
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
            output: emptyLock(params.recordId),
            error: `Agiloft error ${response.status}: ${describeAgiloftError(errorText)}`,
          }
        }

        const data = (await response.json()) as Record<string, unknown>

        /**
         * EWLock answers failures with `{error, error_description}` rather than
         * a lock body, and can do so on a 200 — so the absence of a
         * `lock_status` is the reliable signal, not the status code.
         */
        if (typeof data.lock_status !== 'string') {
          const code = typeof data.error === 'string' ? data.error : 'UNKNOWN'
          const detail =
            typeof data.error_description === 'string'
              ? data.error_description
              : JSON.stringify(data)
          return {
            success: false,
            output: emptyLock(params.recordId),
            error: `Agiloft lock error (${code}): ${detail}`,
          }
        }

        return {
          success: true,
          output: {
            id: String(data.id ?? params.recordId.trim()),
            tableId: typeof data.table_id === 'number' ? data.table_id : null,
            lockStatus: data.lock_status,
            lockedBy: typeof data.locked_by === 'string' ? data.locked_by : null,
            lockExpiresInMinutes:
              typeof data.lock_expires_in_minutes === 'number'
                ? data.lock_expires_in_minutes
                : null,
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
