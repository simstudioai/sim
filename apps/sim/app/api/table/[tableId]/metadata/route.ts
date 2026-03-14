import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import type { TableMetadata } from '@/lib/table'
import { updateTableMetadata } from '@/lib/table'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableMetadataAPI')

const MetadataSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  metadata: z.object({
    columnWidths: z.record(z.number().positive()).optional(),
  }),
})

interface TableRouteParams {
  params: Promise<{ tableId: string }>
}

/** PUT /api/table/[tableId]/metadata - Update table UI metadata (column widths, etc.) */
export async function PUT(request: NextRequest, { params }: TableRouteParams) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized metadata update attempt`)
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = await request.json()
    const validated = MetadataSchema.parse(body)

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
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error updating table metadata:`, error)
    return NextResponse.json({ error: 'Failed to update metadata' }, { status: 500 })
  }
}
