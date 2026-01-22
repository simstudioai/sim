import { db } from '@sim/db'
import { permissions, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  canCreateTable,
  createTable,
  getWorkspaceTableLimits,
  listTables,
  TABLE_LIMITS,
  type TableSchema,
} from '@/lib/table'
import { normalizeColumn } from './utils'

const logger = createLogger('TableAPI')

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

const ListTablesSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
})

interface WorkspaceAccessResult {
  hasAccess: boolean
  canWrite: boolean
}

async function checkWorkspaceAccess(
  workspaceId: string,
  userId: string
): Promise<WorkspaceAccessResult> {
  const [workspaceData] = await db
    .select({
      id: workspace.id,
      ownerId: workspace.ownerId,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)

  if (!workspaceData) {
    return { hasAccess: false, canWrite: false }
  }

  if (workspaceData.ownerId === userId) {
    return { hasAccess: true, canWrite: true }
  }

  const [permission] = await db
    .select({
      permissionType: permissions.permissionType,
    })
    .from(permissions)
    .where(
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspaceId)
      )
    )
    .limit(1)

  if (!permission) {
    return { hasAccess: false, canWrite: false }
  }

  const canWrite = permission.permissionType === 'admin' || permission.permissionType === 'write'

  return {
    hasAccess: true,
    canWrite,
  }
}

/** POST /api/table - Creates a new user-defined table. */
export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request)
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body: unknown = await request.json()
    const params = CreateTableSchema.parse(body)

    const { hasAccess, canWrite } = await checkWorkspaceAccess(
      params.workspaceId,
      authResult.userId
    )

    if (!hasAccess || !canWrite) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Check billing plan limits
    const existingTables = await listTables(params.workspaceId)
    const { canCreate, maxTables } = await canCreateTable(params.workspaceId, existingTables.length)

    if (!canCreate) {
      return NextResponse.json(
        {
          error: `Workspace has reached the maximum table limit (${maxTables}) for your plan. Please upgrade to create more tables.`,
        },
        { status: 403 }
      )
    }

    // Get plan-based row limits
    const planLimits = await getWorkspaceTableLimits(params.workspaceId)
    const maxRowsPerTable = planLimits.maxRowsPerTable

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
        maxRows: maxRowsPerTable,
      },
      requestId
    )

    return NextResponse.json({
      success: true,
      data: {
        table: {
          id: table.id,
          name: table.name,
          description: table.description,
          schema: table.schema,
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
      if (
        error.message.includes('Invalid table name') ||
        error.message.includes('Invalid schema') ||
        error.message.includes('already exists') ||
        error.message.includes('maximum table limit')
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
    }

    logger.error(`[${requestId}] Error creating table:`, error)
    return NextResponse.json({ error: 'Failed to create table' }, { status: 500 })
  }
}

/** GET /api/table - Lists all tables in a workspace. */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request)
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId')

    const validation = ListTablesSchema.safeParse({ workspaceId })
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validation.error.errors },
        { status: 400 }
      )
    }

    const params = validation.data

    const { hasAccess } = await checkWorkspaceAccess(params.workspaceId, authResult.userId)

    if (!hasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const tables = await listTables(params.workspaceId)

    logger.info(`[${requestId}] Listed ${tables.length} tables in workspace ${params.workspaceId}`)

    return NextResponse.json({
      success: true,
      data: {
        tables: tables.map((t) => {
          const schemaData = t.schema as TableSchema
          return {
            ...t,
            schema: {
              columns: schemaData.columns.map(normalizeColumn),
            },
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
}
