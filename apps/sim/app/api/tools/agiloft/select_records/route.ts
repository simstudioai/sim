import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftSelectRecordsContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { AgiloftSelectResponse } from '@/tools/agiloft/types'
import { buildSelectRecordsUrl } from '@/tools/agiloft/utils'
import { executeAgiloftRequest } from '@/tools/agiloft/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftSelectRecordsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Agiloft select_records attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      agiloftSelectRecordsContract,
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

    const result = await executeAgiloftRequest<AgiloftSelectResponse>(
      params,
      (base) => ({
        url: buildSelectRecordsUrl(base, params),
        method: 'GET',
      }),
      async (response) => {
        if (!response.ok) {
          const errorText = await response.text()
          return {
            success: false,
            output: { recordIds: [], totalCount: 0 },
            error: `Agiloft error: ${response.status} - ${errorText}`,
          }
        }

        const data = (await response.json()) as Record<string, unknown>
        const result = (data.result ?? data) as Record<string, unknown>
        const recordIds: string[] = []

        if (Array.isArray(result)) {
          for (const item of result as Record<string, unknown>[]) {
            const id = item.id ?? item.ID ?? item
            recordIds.push(String(id))
          }
        } else if (typeof result === 'object' && result !== null) {
          let i = 0
          while (result[`id_${i}`] !== undefined || result[`EWREST_id_${i}`] !== undefined) {
            const id = result[`id_${i}`] ?? result[`EWREST_id_${i}`]
            recordIds.push(String(id))
            i++
          }
          if (recordIds.length === 0 && result.id !== undefined) {
            recordIds.push(String(result.id))
          }
        }

        const totalCountRaw =
          result.EWREST_id_length ??
          result.totalCount ??
          result.total ??
          result.count ??
          data.EWREST_id_length ??
          data.totalCount ??
          data.total ??
          data.count ??
          recordIds.length

        return {
          success: data.success !== false,
          output: {
            recordIds,
            totalCount: Number(totalCountRaw),
          },
        }
      }
    )

    return NextResponse.json(result)
  } catch (error) {
    logger.error(`[${requestId}] Error selecting Agiloft records:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
