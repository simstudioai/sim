import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftReadRecordContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { AgiloftRecordResponse } from '@/tools/agiloft/types'
import { alrestRecordUrl, alrestSearchUrl, parseFieldList } from '@/tools/agiloft/utils'
import {
  type AgiloftRequestConfig,
  executeAlrestRequest,
  isAgiloftRefusal,
  readAlrestJson,
} from '@/tools/agiloft/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftReadRecordAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Agiloft read_record attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      agiloftReadRecordContract,
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

    /**
     * A full record is large — a contract runs to roughly 184 KB — so when the
     * caller names the fields they want, the read goes through the search
     * endpoint, which is the only route that accepts a `field` projection.
     * Without a field list there is nothing to project and the plain record
     * fetch is cheaper.
     */
    const requestedFields = parseFieldList(params.fields)
    const recordId = params.recordId.trim()

    /**
     * The projected read puts the ID inside a search predicate, so anything
     * other than a plain number could change which records the query selects.
     * Agiloft record IDs are integers, so reject everything else rather than
     * trying to escape it.
     */
    if (requestedFields && !/^\d+$/.test(recordId)) {
      return NextResponse.json({
        success: false,
        output: { id: null, fields: {} },
        error: `Record ID must be numeric to read specific fields, got "${recordId}"`,
      })
    }

    const result = await executeAlrestRequest<AgiloftRecordResponse>(
      params,
      (base): AgiloftRequestConfig => {
        if (!requestedFields) {
          return {
            url: alrestRecordUrl(base, params.table, params.recordId),
            method: 'GET',
            headers: { Accept: 'application/json' },
          }
        }

        return {
          url: alrestSearchUrl(base, params.table),
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            field: requestedFields.includes('id') ? requestedFields : ['id', ...requestedFields],
            query: `id=${recordId}`,
          }),
        }
      },
      async (response) => {
        const payload = await readAlrestJson<Record<string, unknown> | Record<string, unknown>[]>(
          response
        )

        /**
         * Match on ID rather than taking the first row: a search answers with a
         * result set, and returning an unrelated record as a successful read
         * would be worse than failing.
         */
        /**
         * Compare numerically: Agiloft echoes the canonical ID, so a request
         * for `00123` comes back as `123` and a string compare would discard
         * the very record that was asked for.
         */
        const record = Array.isArray(payload)
          ? payload.find((row) => {
              const rowId = String(row?.id ?? '')
              return /^\d+$/.test(rowId) && BigInt(rowId) === BigInt(recordId)
            })
          : payload

        if (!record) {
          return {
            success: false,
            output: { id: null, fields: {} },
            error: `Agiloft returned no record for ID ${recordId}`,
          }
        }

        const id = record.id
        return {
          success: true,
          output: { id: id == null ? null : String(id), fields: record },
        }
      }
    )

    return NextResponse.json(result)
  } catch (error) {
    /**
     * A refusal Agiloft already decided on is a final answer, not a transient
     * fault — returning 500 would make the tool runner retry it.
     */
    if (isAgiloftRefusal(error)) {
      logger.warn(`[${requestId}] Agiloft refused the request`, { error: error.message })
      return NextResponse.json({
        success: false,
        output: { id: null, fields: {} },
        error: error.message,
      })
    }

    logger.error(`[${requestId}] Error reading Agiloft record:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
