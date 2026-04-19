import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { RowData } from '@/lib/table'
import { upsertRow } from '@/lib/table'
import { accessError, checkAccess } from '@/app/api/table/utils'
import {
  checkRateLimit,
  checkWorkspaceScope,
  createRateLimitResponse,
} from '@/app/api/v1/middleware'

const logger = createLogger('V1TableUpsertAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

const UpsertRowSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  data: z.record(z.unknown(), { required_error: 'Row data is required' }),
  conflictTarget: z.string().optional(),
})

interface UpsertRouteParams {
  params: Promise<{ tableId: string }>
}

/** POST /api/v1/tables/[tableId]/rows/upsert — Insert or update a row based on unique columns. */
export async function POST(request: NextRequest, { params }: UpsertRouteParams) {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-rows')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const { tableId } = await params

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
    }

    const validated = UpsertRowSchema.parse(body)

    const scopeError = checkWorkspaceScope(rateLimit, validated.workspaceId)
    if (scopeError) return scopeError

    const result = await checkAccess(tableId, userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const upsertResult = await upsertRow(
      {
        tableId,
        workspaceId: validated.workspaceId,
        data: validated.data as RowData,
        userId,
        conflictTarget: validated.conflictTarget,
      },
      table,
      requestId
    )

    return NextResponse.json({
      success: true,
      data: {
        row: {
          id: upsertResult.row.id,
          data: upsertResult.row.data,
          createdAt:
            upsertResult.row.createdAt instanceof Date
              ? upsertResult.row.createdAt.toISOString()
              : upsertResult.row.createdAt,
          updatedAt:
            upsertResult.row.updatedAt instanceof Date
              ? upsertResult.row.updatedAt.toISOString()
              : upsertResult.row.updatedAt,
        },
        operation: upsertResult.operation,
        message: `Row ${upsertResult.operation === 'update' ? 'updated' : 'inserted'} successfully`,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    const errorMessage = toError(error).message

    if (
      errorMessage.includes('unique column') ||
      errorMessage.includes('Unique constraint violation') ||
      errorMessage.includes('conflictTarget') ||
      errorMessage.includes('row limit') ||
      errorMessage.includes('Schema validation') ||
      errorMessage.includes('Upsert requires') ||
      errorMessage.includes('Row size exceeds')
    ) {
      return NextResponse.json({ error: errorMessage }, { status: 400 })
    }

    logger.error(`[${requestId}] Error upserting row:`, error)
    return NextResponse.json({ error: 'Failed to upsert row' }, { status: 500 })
  }
}
