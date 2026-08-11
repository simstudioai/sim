import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftListTablesContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { AgiloftListTablesResponse, AgiloftTableField } from '@/tools/agiloft/types'
import { buildListTablesUrl } from '@/tools/agiloft/utils'
import { executeAgiloftRequest, readAlrestJson } from '@/tools/agiloft/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftListTablesAPI')

/** Shape of the `result` object EWTable returns. */
interface EwTableResult {
  tables?: Array<{
    label?: string
    logicalName?: string
    fields?: Array<{
      columnName?: string
      columnLabel?: string
      columnType?: string
      columnTypeDomain?: string
      required?: boolean
      isLinked?: boolean
      linkedInfo?: Array<{ linkedTable?: string; linkedColumn?: string }>
      textFieldType?: string
    }>
  }>
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Agiloft list_tables attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      agiloftListTablesContract,
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

    /** EWTable must run under EWLogin or OAuth authorization. */
    const result = await executeAgiloftRequest<AgiloftListTablesResponse>(
      params,
      (base) => ({
        url: buildListTablesUrl(base, params),
        method: 'GET',
        headers: { Accept: 'application/json' },
      }),
      async (response) => {
        const payload = await readAlrestJson<EwTableResult>(response)

        const tables = (payload?.tables ?? []).map((table) => ({
          label: table.label ?? '',
          logicalName: table.logicalName ?? '',
          fields: (table.fields ?? []).map(
            (field): AgiloftTableField => ({
              columnName: field.columnName ?? '',
              columnLabel: field.columnLabel ?? '',
              columnType: field.columnType ?? '',
              columnTypeDomain: field.columnTypeDomain ?? '',
              required: field.required === true,
              isLinked: field.isLinked === true,
              /**
               * Only present when includeLinkedInfo was requested; dropping it
               * would make that option have no observable effect.
               */
              linkedInfo: (field.linkedInfo ?? []).map((link) => ({
                linkedTable: link.linkedTable ?? '',
                linkedColumn: link.linkedColumn ?? '',
              })),
              textFieldType: field.textFieldType ?? null,
            })
          ),
        }))

        return { success: true, output: { tables, totalCount: tables.length } }
      }
    )

    return NextResponse.json(result)
  } catch (error) {
    logger.error(`[${requestId}] Error listing Agiloft tables:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
