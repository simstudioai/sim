import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { updateTableMetadataContract } from '@/lib/api/contracts/tables'
import { parseRequest, validationErrorResponse } from '@/lib/api/server/validation'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { TableMetadata } from '@/lib/table'
import { updateTableMetadata } from '@/lib/table'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableMetadataAPI')

interface TableRouteParams {
  params: Promise<{ tableId: string }>
}

/** PUT /api/table/[tableId]/metadata - Update table UI metadata (column widths, etc.) */
export const PUT = withRouteHandler(async (request: NextRequest, context: TableRouteParams) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized metadata update attempt`)
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const parsed = await parseRequest(updateTableMetadataContract, request, context, {
      validationErrorResponse: (error) => validationErrorResponse(error),
    })
    if (!parsed.success) return parsed.response

    const { tableId } = parsed.data.params
    const validated = parsed.data.body

    const result = await checkAccess(tableId, authResult.userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const updated = await updateTableMetadata(
      tableId,
      validated.metadata,
      table.metadata as TableMetadata | null
    )

    return NextResponse.json({ success: true, data: { metadata: updated } })
  } catch (error) {
    logger.error(`[${requestId}] Error updating table metadata:`, error)
    return NextResponse.json({ error: 'Failed to update metadata' }, { status: 500 })
  }
})
