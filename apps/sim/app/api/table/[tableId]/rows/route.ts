import { db } from '@sim/db'
import { permissions, userTableDefinitions, userTableRows, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import type { QueryFilter, TableSchema } from '@/lib/table'
import {
  getUniqueColumns,
  TABLE_LIMITS,
  validateRowAgainstSchema,
  validateRowSize,
  validateUniqueConstraints,
} from '@/lib/table'
import { buildFilterClause, buildSortClause } from '@/lib/table/query-builder'

const logger = createLogger('TableRowsAPI')

const InsertRowSchema = z.object({
  workspaceId: z.string().min(1),
  data: z.record(z.any()),
})

const BatchInsertRowsSchema = z.object({
  workspaceId: z.string().min(1),
  rows: z.array(z.record(z.any())).min(1).max(1000), // Max 1000 rows per batch
})

const QueryRowsSchema = z.object({
  workspaceId: z.string().min(1),
  filter: z.record(z.any()).optional(),
  sort: z.record(z.enum(['asc', 'desc'])).optional(),
  limit: z.coerce.number().int().min(1).max(TABLE_LIMITS.MAX_QUERY_LIMIT).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
})

const UpdateRowsByFilterSchema = z.object({
  workspaceId: z.string().min(1),
  filter: z.record(z.any()), // Required - must specify what to update
  data: z.record(z.any()), // New data to set
  limit: z.coerce.number().int().min(1).max(1000).optional(), // Safety limit for bulk updates
})

const DeleteRowsByFilterSchema = z.object({
  workspaceId: z.string().min(1),
  filter: z.record(z.any()), // Required - must specify what to delete
  limit: z.coerce.number().int().min(1).max(1000).optional(), // Safety limit for bulk deletes
})

/**
 * Check if user has write access to workspace
 */
async function checkWorkspaceAccess(workspaceId: string, userId: string) {
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

/**
 * Handle batch insert of multiple rows
 */
async function handleBatchInsert(requestId: string, tableId: string, body: any, userId: string) {
  const validated = BatchInsertRowsSchema.parse(body)

  // Check workspace access
  const { hasAccess, canWrite } = await checkWorkspaceAccess(validated.workspaceId, userId)

  if (!hasAccess || !canWrite) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Get table definition
  const [table] = await db
    .select()
    .from(userTableDefinitions)
    .where(
      and(
        eq(userTableDefinitions.id, tableId),
        eq(userTableDefinitions.workspaceId, validated.workspaceId),
        isNull(userTableDefinitions.deletedAt)
      )
    )
    .limit(1)

  if (!table) {
    return NextResponse.json({ error: 'Table not found' }, { status: 404 })
  }

  // Check row count limit
  const remainingCapacity = table.maxRows - table.rowCount
  if (remainingCapacity < validated.rows.length) {
    return NextResponse.json(
      {
        error: `Insufficient capacity. Can only insert ${remainingCapacity} more rows (table has ${table.rowCount}/${table.maxRows} rows)`,
      },
      { status: 400 }
    )
  }

  // Validate all rows
  const errors: { row: number; errors: string[] }[] = []

  for (let i = 0; i < validated.rows.length; i++) {
    const rowData = validated.rows[i]

    // Validate row size
    const sizeValidation = validateRowSize(rowData)
    if (!sizeValidation.valid) {
      errors.push({ row: i, errors: sizeValidation.errors })
      continue
    }

    // Validate row against schema
    const rowValidation = validateRowAgainstSchema(rowData, table.schema as TableSchema)
    if (!rowValidation.valid) {
      errors.push({ row: i, errors: rowValidation.errors })
    }
  }

  if (errors.length > 0) {
    return NextResponse.json(
      {
        error: 'Validation failed for some rows',
        details: errors,
      },
      { status: 400 }
    )
  }

  // Check unique constraints if any unique columns exist
  const uniqueColumns = getUniqueColumns(table.schema as TableSchema)
  if (uniqueColumns.length > 0) {
    // Fetch existing rows to check for uniqueness
    const existingRows = await db
      .select({
        id: userTableRows.id,
        data: userTableRows.data,
      })
      .from(userTableRows)
      .where(eq(userTableRows.tableId, tableId))

    // Validate each row for unique constraints
    for (let i = 0; i < validated.rows.length; i++) {
      const rowData = validated.rows[i]

      // Also check against other rows in the batch
      const batchRows = validated.rows.slice(0, i).map((data, idx) => ({
        id: `batch_${idx}`,
        data,
      }))

      const uniqueValidation = validateUniqueConstraints(rowData, table.schema as TableSchema, [
        ...existingRows,
        ...batchRows,
      ])

      if (!uniqueValidation.valid) {
        errors.push({ row: i, errors: uniqueValidation.errors })
      }
    }

    if (errors.length > 0) {
      return NextResponse.json(
        {
          error: 'Unique constraint violations in batch',
          details: errors,
        },
        { status: 400 }
      )
    }
  }

  // Insert all rows
  const now = new Date()
  const rowsToInsert = validated.rows.map((data) => ({
    id: `row_${crypto.randomUUID().replace(/-/g, '')}`,
    tableId,
    workspaceId: validated.workspaceId,
    data,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
  }))

  const insertedRows = await db.insert(userTableRows).values(rowsToInsert).returning()

  // Update row count
  await db
    .update(userTableDefinitions)
    .set({
      rowCount: sql`${userTableDefinitions.rowCount} + ${validated.rows.length}`,
      updatedAt: now,
    })
    .where(eq(userTableDefinitions.id, tableId))

  logger.info(`[${requestId}] Batch inserted ${insertedRows.length} rows into table ${tableId}`)

  return NextResponse.json({
    rows: insertedRows.map((r) => ({
      id: r.id,
      data: r.data,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    insertedCount: insertedRows.length,
    message: `Successfully inserted ${insertedRows.length} rows`,
  })
}

/**
 * POST /api/table/[tableId]/rows
 * Insert a new row into the table
 * Supports both single row and batch insert (NDJSON format)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tableId: string }> }
) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkHybridAuth(request)
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = await request.json()

    // Check if this is a batch insert
    if (body.rows && Array.isArray(body.rows)) {
      return handleBatchInsert(requestId, tableId, body, authResult.userId)
    }

    // Single row insert
    const validated = InsertRowSchema.parse(body)

    // Check workspace access
    const { hasAccess, canWrite } = await checkWorkspaceAccess(
      validated.workspaceId,
      authResult.userId
    )

    if (!hasAccess || !canWrite) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Get table definition
    const [table] = await db
      .select()
      .from(userTableDefinitions)
      .where(
        and(
          eq(userTableDefinitions.id, tableId),
          eq(userTableDefinitions.workspaceId, validated.workspaceId),
          isNull(userTableDefinitions.deletedAt)
        )
      )
      .limit(1)

    if (!table) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    }

    // Validate row size
    const sizeValidation = validateRowSize(validated.data)
    if (!sizeValidation.valid) {
      return NextResponse.json(
        { error: 'Invalid row data', details: sizeValidation.errors },
        { status: 400 }
      )
    }

    // Validate row against schema
    const rowValidation = validateRowAgainstSchema(validated.data, table.schema as TableSchema)
    if (!rowValidation.valid) {
      return NextResponse.json(
        { error: 'Row data does not match schema', details: rowValidation.errors },
        { status: 400 }
      )
    }

    // Check unique constraints if any unique columns exist
    const uniqueColumns = getUniqueColumns(table.schema as TableSchema)
    if (uniqueColumns.length > 0) {
      // Fetch existing rows to check for uniqueness
      const existingRows = await db
        .select({
          id: userTableRows.id,
          data: userTableRows.data,
        })
        .from(userTableRows)
        .where(eq(userTableRows.tableId, tableId))

      const uniqueValidation = validateUniqueConstraints(
        validated.data,
        table.schema as TableSchema,
        existingRows
      )

      if (!uniqueValidation.valid) {
        return NextResponse.json(
          { error: 'Unique constraint violation', details: uniqueValidation.errors },
          { status: 400 }
        )
      }
    }

    // Check row count limit
    if (table.rowCount >= table.maxRows) {
      return NextResponse.json(
        { error: `Table row limit reached (${table.maxRows} rows max)` },
        { status: 400 }
      )
    }

    // Insert row
    const rowId = `row_${crypto.randomUUID().replace(/-/g, '')}`
    const now = new Date()

    const [row] = await db
      .insert(userTableRows)
      .values({
        id: rowId,
        tableId,
        workspaceId: validated.workspaceId,
        data: validated.data,
        createdAt: now,
        updatedAt: now,
        createdBy: authResult.userId,
      })
      .returning()

    // Update row count
    await db
      .update(userTableDefinitions)
      .set({
        rowCount: sql`${userTableDefinitions.rowCount} + 1`,
        updatedAt: now,
      })
      .where(eq(userTableDefinitions.id, tableId))

    logger.info(`[${requestId}] Inserted row ${rowId} into table ${tableId}`)

    return NextResponse.json({
      row: {
        id: row.id,
        data: row.data,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
      message: 'Row inserted successfully',
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error inserting row:`, error)
    return NextResponse.json({ error: 'Failed to insert row' }, { status: 500 })
  }
}

/**
 * GET /api/table/[tableId]/rows?workspaceId=xxx&filter=...&sort=...&limit=100&offset=0
 * Query rows from the table with filtering, sorting, and pagination
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tableId: string }> }
) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkHybridAuth(request)
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId')
    const filterParam = searchParams.get('filter')
    const sortParam = searchParams.get('sort')
    const limit = searchParams.get('limit')
    const offset = searchParams.get('offset')

    let filter
    let sort

    try {
      if (filterParam) {
        filter = JSON.parse(filterParam)
      }
      if (sortParam) {
        sort = JSON.parse(sortParam)
      }
    } catch {
      return NextResponse.json({ error: 'Invalid filter or sort JSON' }, { status: 400 })
    }

    const validated = QueryRowsSchema.parse({
      workspaceId,
      filter,
      sort,
      limit,
      offset,
    })

    // Check workspace access
    const { hasAccess } = await checkWorkspaceAccess(validated.workspaceId, authResult.userId)

    if (!hasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Verify table exists
    const [table] = await db
      .select({ id: userTableDefinitions.id })
      .from(userTableDefinitions)
      .where(
        and(
          eq(userTableDefinitions.id, tableId),
          eq(userTableDefinitions.workspaceId, validated.workspaceId),
          isNull(userTableDefinitions.deletedAt)
        )
      )
      .limit(1)

    if (!table) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    }

    // Build base where conditions
    const baseConditions = [
      eq(userTableRows.tableId, tableId),
      eq(userTableRows.workspaceId, validated.workspaceId),
    ]

    // Add filter conditions if provided
    if (validated.filter) {
      const filterClause = buildFilterClause(validated.filter as QueryFilter, 'user_table_rows')
      if (filterClause) {
        baseConditions.push(filterClause)
      }
    }

    // Build query with combined conditions
    let query = db
      .select({
        id: userTableRows.id,
        data: userTableRows.data,
        createdAt: userTableRows.createdAt,
        updatedAt: userTableRows.updatedAt,
      })
      .from(userTableRows)
      .where(and(...baseConditions))

    // Apply sorting
    if (validated.sort) {
      const sortClause = buildSortClause(validated.sort, 'user_table_rows')
      if (sortClause) {
        query = query.orderBy(sortClause) as any
      }
    } else {
      query = query.orderBy(userTableRows.createdAt) as any
    }

    // Get total count with same filters (without pagination)
    const countQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(userTableRows)
      .where(and(...baseConditions))

    const [{ count: totalCount }] = await countQuery

    // Apply pagination
    const rows = await query.limit(validated.limit).offset(validated.offset)

    logger.info(
      `[${requestId}] Queried ${rows.length} rows from table ${tableId} (total: ${totalCount})`
    )

    return NextResponse.json({
      rows: rows.map((r) => ({
        id: r.id,
        data: r.data,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      rowCount: rows.length,
      totalCount: Number(totalCount),
      limit: validated.limit,
      offset: validated.offset,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error querying rows:`, error)
    return NextResponse.json({ error: 'Failed to query rows' }, { status: 500 })
  }
}

/**
 * PUT /api/table/[tableId]/rows
 * Update multiple rows by filter criteria
 * Example: Update all rows where name contains "test"
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tableId: string }> }
) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkHybridAuth(request)
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = await request.json()
    const validated = UpdateRowsByFilterSchema.parse(body)

    // Check workspace access
    const { hasAccess, canWrite } = await checkWorkspaceAccess(
      validated.workspaceId,
      authResult.userId
    )

    if (!hasAccess || !canWrite) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Get table definition
    const [table] = await db
      .select()
      .from(userTableDefinitions)
      .where(
        and(
          eq(userTableDefinitions.id, tableId),
          eq(userTableDefinitions.workspaceId, validated.workspaceId),
          isNull(userTableDefinitions.deletedAt)
        )
      )
      .limit(1)

    if (!table) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    }

    // Validate new data size
    const sizeValidation = validateRowSize(validated.data)
    if (!sizeValidation.valid) {
      return NextResponse.json(
        { error: 'Invalid row data', details: sizeValidation.errors },
        { status: 400 }
      )
    }

    // Build base where conditions
    const baseConditions = [
      eq(userTableRows.tableId, tableId),
      eq(userTableRows.workspaceId, validated.workspaceId),
    ]

    // Add filter conditions
    const filterClause = buildFilterClause(validated.filter as QueryFilter, 'user_table_rows')
    if (filterClause) {
      baseConditions.push(filterClause)
    }

    // First, get the rows that match the filter to validate against schema
    let matchingRowsQuery = db
      .select({
        id: userTableRows.id,
        data: userTableRows.data,
      })
      .from(userTableRows)
      .where(and(...baseConditions))

    if (validated.limit) {
      matchingRowsQuery = matchingRowsQuery.limit(validated.limit) as any
    }

    const matchingRows = await matchingRowsQuery

    if (matchingRows.length === 0) {
      return NextResponse.json(
        {
          message: 'No rows matched the filter criteria',
          updatedCount: 0,
        },
        { status: 200 }
      )
    }

    // Log warning for large operations but allow them
    if (matchingRows.length > 1000) {
      logger.warn(`[${requestId}] Updating ${matchingRows.length} rows. This may take some time.`)
    }

    // Validate that merged data matches schema for each row
    for (const row of matchingRows) {
      const mergedData = { ...row.data, ...validated.data }
      const rowValidation = validateRowAgainstSchema(mergedData, table.schema as TableSchema)
      if (!rowValidation.valid) {
        return NextResponse.json(
          {
            error: 'Updated data does not match schema',
            details: rowValidation.errors,
            affectedRowId: row.id,
          },
          { status: 400 }
        )
      }
    }

    // Check unique constraints if any unique columns exist
    const uniqueColumns = getUniqueColumns(table.schema as TableSchema)
    if (uniqueColumns.length > 0) {
      // Fetch all rows (not just matching ones) to check for uniqueness
      const allRows = await db
        .select({
          id: userTableRows.id,
          data: userTableRows.data,
        })
        .from(userTableRows)
        .where(eq(userTableRows.tableId, tableId))

      // Validate each updated row for unique constraints
      for (const row of matchingRows) {
        const mergedData = { ...row.data, ...validated.data }
        const uniqueValidation = validateUniqueConstraints(
          mergedData,
          table.schema as TableSchema,
          allRows,
          row.id // Exclude the current row being updated
        )

        if (!uniqueValidation.valid) {
          return NextResponse.json(
            {
              error: 'Unique constraint violation',
              details: uniqueValidation.errors,
              affectedRowId: row.id,
            },
            { status: 400 }
          )
        }
      }
    }

    // Update rows by merging existing data with new data in batches
    const now = new Date()
    const BATCH_SIZE = 100 // Smaller batch for updates since each is a separate query
    let totalUpdated = 0

    for (let i = 0; i < matchingRows.length; i += BATCH_SIZE) {
      const batch = matchingRows.slice(i, i + BATCH_SIZE)
      const updatePromises = batch.map((row) =>
        db
          .update(userTableRows)
          .set({
            data: { ...row.data, ...validated.data },
            updatedAt: now,
          })
          .where(eq(userTableRows.id, row.id))
      )
      await Promise.all(updatePromises)
      totalUpdated += batch.length
      logger.info(
        `[${requestId}] Updated batch ${Math.floor(i / BATCH_SIZE) + 1} (${totalUpdated}/${matchingRows.length} rows)`
      )
    }

    logger.info(`[${requestId}] Updated ${matchingRows.length} rows in table ${tableId}`)

    return NextResponse.json({
      message: 'Rows updated successfully',
      updatedCount: matchingRows.length,
      updatedRowIds: matchingRows.map((r) => r.id),
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error updating rows by filter:`, error)

    const errorMessage = error instanceof Error ? error.message : String(error)
    const detailedError = `Failed to update rows: ${errorMessage}`

    return NextResponse.json({ error: detailedError }, { status: 500 })
  }
}

/**
 * DELETE /api/table/[tableId]/rows
 * Delete multiple rows by filter criteria
 * Example: Delete all rows where seen is false
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tableId: string }> }
) {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkHybridAuth(request)
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = await request.json()
    const validated = DeleteRowsByFilterSchema.parse(body)

    // Check workspace access
    const { hasAccess, canWrite } = await checkWorkspaceAccess(
      validated.workspaceId,
      authResult.userId
    )

    if (!hasAccess || !canWrite) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Verify table exists
    const [table] = await db
      .select({ id: userTableDefinitions.id })
      .from(userTableDefinitions)
      .where(
        and(
          eq(userTableDefinitions.id, tableId),
          eq(userTableDefinitions.workspaceId, validated.workspaceId),
          isNull(userTableDefinitions.deletedAt)
        )
      )
      .limit(1)

    if (!table) {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    }

    // Build base where conditions
    const baseConditions = [
      eq(userTableRows.tableId, tableId),
      eq(userTableRows.workspaceId, validated.workspaceId),
    ]

    // Add filter conditions
    const filterClause = buildFilterClause(validated.filter as QueryFilter, 'user_table_rows')
    if (filterClause) {
      baseConditions.push(filterClause)
    }

    // Get matching rows first (for reporting and limit enforcement)
    let matchingRowsQuery = db
      .select({ id: userTableRows.id })
      .from(userTableRows)
      .where(and(...baseConditions))

    if (validated.limit) {
      matchingRowsQuery = matchingRowsQuery.limit(validated.limit) as any
    }

    const matchingRows = await matchingRowsQuery

    if (matchingRows.length === 0) {
      return NextResponse.json(
        {
          message: 'No rows matched the filter criteria',
          deletedCount: 0,
        },
        { status: 200 }
      )
    }

    // Log warning for large operations but allow them
    if (matchingRows.length > 1000) {
      logger.warn(`[${requestId}] Deleting ${matchingRows.length} rows. This may take some time.`)
    }

    // Delete the matching rows in batches to avoid stack overflow
    const rowIds = matchingRows.map((r) => r.id)
    const BATCH_SIZE = 1000
    let totalDeleted = 0

    for (let i = 0; i < rowIds.length; i += BATCH_SIZE) {
      const batch = rowIds.slice(i, i + BATCH_SIZE)
      await db.delete(userTableRows).where(
        and(
          eq(userTableRows.tableId, tableId),
          eq(userTableRows.workspaceId, validated.workspaceId),
          sql`${userTableRows.id} = ANY(ARRAY[${sql.join(
            batch.map((id) => sql`${id}`),
            sql`, `
          )}])`
        )
      )
      totalDeleted += batch.length
      logger.info(
        `[${requestId}] Deleted batch ${Math.floor(i / BATCH_SIZE) + 1} (${totalDeleted}/${rowIds.length} rows)`
      )
    }

    // Update row count
    await db
      .update(userTableDefinitions)
      .set({
        rowCount: sql`${userTableDefinitions.rowCount} - ${matchingRows.length}`,
        updatedAt: new Date(),
      })
      .where(eq(userTableDefinitions.id, tableId))

    logger.info(`[${requestId}] Deleted ${matchingRows.length} rows from table ${tableId}`)

    return NextResponse.json({
      message: 'Rows deleted successfully',
      deletedCount: matchingRows.length,
      deletedRowIds: rowIds,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error deleting rows by filter:`, error)

    const errorMessage = error instanceof Error ? error.message : String(error)
    const detailedError = `Failed to delete rows: ${errorMessage}`

    return NextResponse.json({ error: detailedError }, { status: 500 })
  }
}
