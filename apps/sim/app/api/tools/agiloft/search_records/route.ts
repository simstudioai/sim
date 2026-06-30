import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftSearchRecordsContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { AgiloftSearchResponse } from '@/tools/agiloft/types'
import { buildSearchRecordsUrl } from '@/tools/agiloft/utils'
import { executeAgiloftRequest } from '@/tools/agiloft/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftSearchRecordsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Agiloft search_records attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      agiloftSearchRecordsContract,
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

    const result = await executeAgiloftRequest<AgiloftSearchResponse>(
      params,
      (base) => ({
        url: buildSearchRecordsUrl(base, params),
        method: 'GET',
      }),
      async (response) => {
        if (!response.ok) {
          const errorText = await response.text()
          return {
            success: false,
            output: { records: [], totalCount: 0, page: 0, limit: 25 },
            error: `Agiloft error: ${response.status} - ${errorText}`,
          }
        }

        const data = (await response.json()) as Record<string, unknown>
        const records: Record<string, unknown>[] = []
        const result = (data.result ?? data) as Record<string, unknown>

        if (Array.isArray(result)) {
          for (const item of result as Record<string, unknown>[]) {
            records.push(item)
          }
        } else {
          const lengthRaw = result.EWREST_length ?? data.EWREST_length
          const count = typeof lengthRaw === 'string' ? Number(lengthRaw) : (lengthRaw as number)
          if (typeof count === 'number' && Number.isFinite(count)) {
            const source = (result.EWREST_length != null ? result : data) as Record<string, unknown>
            for (let i = 0; i < count; i++) {
              const record: Record<string, unknown> = {}
              for (const key of Object.keys(source)) {
                const match = key.match(/^EWREST_(.+)_(\d+)$/)
                if (match && Number(match[2]) === i) {
                  record[match[1]] = source[key]
                }
              }
              if (Object.keys(record).length > 0) {
                records.push(record)
              }
            }
          }
        }

        const totalCountRaw =
          result.totalCount ??
          result.total ??
          result.count ??
          result.EWREST_length ??
          data.totalCount ??
          data.total ??
          data.count ??
          data.EWREST_length ??
          records.length
        const totalCount =
          typeof totalCountRaw === 'string' ? Number(totalCountRaw) : (totalCountRaw as number)
        const page = params.page ? Number(params.page) : 0
        const limit = params.limit ? Number(params.limit) : 25

        return {
          success: data.success !== false,
          output: {
            records,
            totalCount,
            page,
            limit,
          },
        }
      }
    )

    return NextResponse.json(result)
  } catch (error) {
    logger.error(`[${requestId}] Error searching Agiloft records:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
