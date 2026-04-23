import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createTable,
  getWorkspaceTableLimits,
  listTables,
  TABLE_LIMITS,
  type TableSchema,
} from '@/lib/table'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { normalizeColumn } from '@/app/api/table/utils'
import {
  checkRateLimit,
  checkWorkspaceScope,
  createRateLimitResponse,
} from '@/app/api/v1/middleware'

const logger = createLogger('V1TablesAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

const ListTablesSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId query parameter is required'),
})

const ColumnSchema = z.object({
  name: z
    .string()
    .min(1, 'Column name is required')
    .max(
      TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH,
      `Column name must be ${TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH} characters or less`
    )
    .regex(
      /^[a-z_][a-z0-9_]*$/i,
      'Column name must start with a letter or underscore and contain only alphanumeric characters and underscores'
    ),
  type: z.enum(['string', 'number', 'boolean', 'date', 'json'], {
    errorMap: () => ({
      message: 'Column type must be one of: string, number, boolean, date, json',
    }),
  }),
  required: z.boolean().optional().default(false),
  unique: z.boolean().optional().default(false),
})

const CreateTableSchema = z.object({
  name: z
    .string()
    .min(1, 'Table name is required')
    .max(
      TABLE_LIMITS.MAX_TABLE_NAME_LENGTH,
      `Table name must be ${TABLE_LIMITS.MAX_TABLE_NAME_LENGTH} characters or less`
    )
    .regex(
      /^[a-z_][a-z0-9_]*$/i,
      'Table name must start with a letter or underscore and contain only alphanumeric characters and underscores'
    ),
  description: z
    .string()
    .max(
      TABLE_LIMITS.MAX_DESCRIPTION_LENGTH,
      `Description must be ${TABLE_LIMITS.MAX_DESCRIPTION_LENGTH} characters or less`
    )
    .optional(),
  schema: z.object({
    columns: z
      .array(ColumnSchema)
      .min(1, 'Table must have at least one column')
      .max(
        TABLE_LIMITS.MAX_COLUMNS_PER_TABLE,
        `Table cannot have more than ${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE} columns`
      ),
  }),
  workspaceId: z.string().min(1, 'Workspace ID is required'),
})

/** GET /api/v1/tables — List all tables in a workspace. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'tables')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const { searchParams } = new URL(request.url)

    const validation = ListTablesSchema.safeParse({
      workspaceId: searchParams.get('workspaceId'),
    })
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validation.error.errors },
        { status: 400 }
      )
    }

    const { workspaceId } = validation.data

    const scopeError = checkWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return scopeError

    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (permission === null) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const tables = await listTables(workspaceId)

    return NextResponse.json({
      success: true,
      data: {
        tables: tables.map((t) => {
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
            createdAt:
              t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
            updatedAt:
              t.updatedAt instanceof Date ? t.updatedAt.toISOString() : String(t.updatedAt),
          }
        }),
        totalCount: tables.length,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error listing tables:`, error)
    return NextResponse.json({ error: 'Failed to list tables' }, { status: 500 })
  }
})

/** POST /api/v1/tables — Create a new table. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'tables')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
    }

    const params = CreateTableSchema.parse(body)

    const scopeError = checkWorkspaceScope(rateLimit, params.workspaceId)
    if (scopeError) return scopeError

    const permission = await getUserEntityPermissions(userId, 'workspace', params.workspaceId)
    if (permission === null || permission === 'read') {
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
        userId,
        maxRows: planLimits.maxRowsPerTable,
        maxTables: planLimits.maxTables,
      },
      requestId
    )

    recordAudit({
      workspaceId: params.workspaceId,
      actorId: userId,
      action: AuditAction.TABLE_CREATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: table.id,
      resourceName: table.name,
      description: `Created table "${table.name}" via API`,
      metadata: { columnCount: params.schema.columns.length },
      request,
    })

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
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

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
