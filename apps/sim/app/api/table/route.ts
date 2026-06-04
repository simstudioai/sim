import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { createTableContract, listTablesQuerySchema } from '@/lib/api/contracts/tables'
import { isZodError, parseRequest, validationErrorResponse } from '@/lib/api/server/validation'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  createTable,
  getWorkspaceTableLimits,
  listTables,
  type TableSchema,
  type TableScope,
} from '@/lib/table'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { normalizeColumn } from '@/app/api/table/utils'

const logger = createLogger('TableAPI')

interface WorkspaceAccessResult {
  hasAccess: boolean
  canWrite: boolean
}

async function checkWorkspaceAccess(
  workspaceId: string,
  userId: string
): Promise<WorkspaceAccessResult> {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)

  if (permission === null) {
    return { hasAccess: false, canWrite: false }
  }

  const canWrite = permission === 'admin' || permission === 'write'
  return { hasAccess: true, canWrite }
}

/** POST /api/table - Creates a new user-defined table. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const parsed = await parseRequest(
      createTableContract,
      request,
      {},
      {
        validationErrorResponse: (error) => validationErrorResponse(error),
      }
    )
    if (!parsed.success) return parsed.response

    const params = parsed.data.body

    const { hasAccess, canWrite } = await checkWorkspaceAccess(
      params.workspaceId,
      authResult.userId
    )

    if (!hasAccess || !canWrite) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const planLimits = await getWorkspaceTableLimits(params.workspaceId)

    const normalizedSchema: TableSchema = {
      columns: params.schema.columns.map(normalizeColumn),
    }

    const table = await createTable(
      {
        name: params.name,
        description: params.description,
        schema: normalizedSchema,
        workspaceId: params.workspaceId,
        userId: authResult.userId,
        maxRows: planLimits.maxRowsPerTable,
        maxTables: planLimits.maxTables,
        initialRowCount: params.initialRowCount,
      },
      requestId
    )

    captureServerEvent(
      authResult.userId,
      'table_created',
      {
        table_id: table.id,
        workspace_id: params.workspaceId,
        column_count: params.schema.columns.length,
      },
      {
        groups: { workspace: params.workspaceId },
        setOnce: { first_table_created_at: new Date().toISOString() },
      }
    )

    return NextResponse.json({
      success: true,
      data: {
        table: {
          id: table.id,
          name: table.name,
          description: table.description,
          schema: {
            columns: (table.schema as TableSchema).columns.map(normalizeColumn),
          },
          rowCount: table.rowCount,
          maxRows: table.maxRows,
          createdAt:
            table.createdAt instanceof Date
              ? table.createdAt.toISOString()
              : String(table.createdAt),
          updatedAt:
            table.updatedAt instanceof Date
              ? table.updatedAt.toISOString()
              : String(table.updatedAt),
        },
        message: 'Table created successfully',
      },
    })
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('maximum table limit')) {
        return NextResponse.json({ error: error.message }, { status: 403 })
      }
      if (
        error.message.includes('Invalid table name') ||
        error.message.includes('Invalid schema') ||
        error.message.includes('already exists')
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
    }

    logger.error(`[${requestId}] Error creating table:`, error)
    return NextResponse.json({ error: 'Failed to create table' }, { status: 500 })
  }
})

/** GET /api/table - Lists all tables in a workspace. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId')
    const scope = searchParams.get('scope')

    const validation = listTablesQuerySchema.safeParse({
      workspaceId,
      scope: scope ?? undefined,
    })
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validation.error.issues },
        { status: 400 }
      )
    }

    const params = validation.data

    const { hasAccess } = await checkWorkspaceAccess(params.workspaceId, authResult.userId)

    if (!hasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const tables = await listTables(params.workspaceId, { scope: params.scope as TableScope })

    logger.info(`[${requestId}] Listed ${tables.length} tables in workspace ${params.workspaceId}`)

    const responseTables = tables.map((t) => {
      const schemaData = t.schema as TableSchema
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        schema: {
          columns: schemaData.columns.map(normalizeColumn),
        },
        rowCount: t.rowCount,
        maxRows: t.maxRows,
        workspaceId: t.workspaceId,
        createdBy: t.createdBy,
        createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
        updatedAt: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : String(t.updatedAt),
        archivedAt:
          t.archivedAt instanceof Date
            ? t.archivedAt.toISOString()
            : t.archivedAt
              ? String(t.archivedAt)
              : null,
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        tables: responseTables,
        totalCount: tables.length,
      },
    })
  } catch (error) {
    if (isZodError(error)) {
      return validationErrorResponse(error)
    }

    logger.error(`[${requestId}] Error listing tables:`, error)
    return NextResponse.json({ error: 'Failed to list tables' }, { status: 500 })
  }
})
