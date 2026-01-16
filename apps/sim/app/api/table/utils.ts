import { db } from '@sim/db'
import { userTableDefinitions, userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { count, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import type { ColumnDefinition, TableDefinition } from '@/lib/table'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('TableUtils')

type PermissionLevel = 'read' | 'write' | 'admin'

/** @deprecated Use TableDefinition from '@/lib/table' instead */
export type TableData = TableDefinition

export interface TableAccessResult {
  hasAccess: true
  table: Pick<TableDefinition, 'id' | 'workspaceId' | 'createdBy'>
}

export interface TableAccessResultFull {
  hasAccess: true
  table: TableDefinition
}

export interface TableAccessDenied {
  hasAccess: false
  notFound?: boolean
  reason?: string
}

export interface ApiErrorResponse {
  error: string
  details?: unknown
}

export async function checkTableAccess(
  tableId: string,
  userId: string
): Promise<TableAccessResult | TableAccessDenied> {
  return checkTableAccessInternal(tableId, userId, 'read')
}

export async function checkTableWriteAccess(
  tableId: string,
  userId: string
): Promise<TableAccessResult | TableAccessDenied> {
  return checkTableAccessInternal(tableId, userId, 'write')
}

export async function checkAccessOrRespond(
  tableId: string,
  userId: string,
  requestId: string,
  level: 'read' | 'write' | 'admin' = 'write'
): Promise<TableAccessResult | NextResponse> {
  const checkFn = level === 'read' ? checkTableAccess : checkTableWriteAccess
  const accessCheck = await checkFn(tableId, userId)

  if (!accessCheck.hasAccess) {
    if ('notFound' in accessCheck && accessCheck.notFound) {
      logger.warn(`[${requestId}] Table not found: ${tableId}`)
      return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    }
    logger.warn(`[${requestId}] User ${userId} denied ${level} access to table ${tableId}`)
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  return accessCheck
}

export async function checkAccessWithFullTable(
  tableId: string,
  userId: string,
  requestId: string,
  level: 'read' | 'write' | 'admin' = 'write'
): Promise<TableAccessResultFull | NextResponse> {
  const [tableData] = await db
    .select()
    .from(userTableDefinitions)
    .where(eq(userTableDefinitions.id, tableId))
    .limit(1)

  if (!tableData) {
    logger.warn(`[${requestId}] Table not found: ${tableId}`)
    return NextResponse.json({ error: 'Table not found' }, { status: 404 })
  }

  const rowCount = await getTableRowCount(tableId)
  const table = { ...tableData, rowCount } as unknown as TableDefinition

  if (table.createdBy === userId) {
    return { hasAccess: true, table }
  }

  const userPermission = await getUserEntityPermissions(userId, 'workspace', table.workspaceId)

  if (!hasPermissionLevel(userPermission, level)) {
    logger.warn(`[${requestId}] User ${userId} denied ${level} access to table ${tableId}`)
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  return { hasAccess: true, table }
}

export async function getTableById(tableId: string): Promise<TableDefinition | null> {
  const [table] = await db
    .select()
    .from(userTableDefinitions)
    .where(eq(userTableDefinitions.id, tableId))
    .limit(1)

  if (!table) {
    return null
  }

  const rowCount = await getTableRowCount(tableId)
  return { ...table, rowCount } as unknown as TableDefinition
}

export async function verifyTableWorkspace(tableId: string, workspaceId: string): Promise<boolean> {
  const table = await db
    .select({ workspaceId: userTableDefinitions.workspaceId })
    .from(userTableDefinitions)
    .where(eq(userTableDefinitions.id, tableId))
    .limit(1)

  if (table.length === 0) {
    return false
  }

  return table[0].workspaceId === workspaceId
}

async function checkTableAccessInternal(
  tableId: string,
  userId: string,
  requiredLevel: 'read' | 'write' | 'admin'
): Promise<TableAccessResult | TableAccessDenied> {
  const table = await db
    .select({
      id: userTableDefinitions.id,
      createdBy: userTableDefinitions.createdBy,
      workspaceId: userTableDefinitions.workspaceId,
    })
    .from(userTableDefinitions)
    .where(eq(userTableDefinitions.id, tableId))
    .limit(1)

  if (table.length === 0) {
    return { hasAccess: false, notFound: true }
  }

  const tableData = table[0]

  if (tableData.createdBy === userId) {
    return { hasAccess: true, table: tableData }
  }

  const userPermission = await getUserEntityPermissions(userId, 'workspace', tableData.workspaceId)

  if (hasPermissionLevel(userPermission, requiredLevel)) {
    return { hasAccess: true, table: tableData }
  }

  return { hasAccess: false }
}

function hasPermissionLevel(
  userPermission: 'read' | 'write' | 'admin' | null,
  requiredLevel: PermissionLevel
): boolean {
  if (userPermission === null) return false

  switch (requiredLevel) {
    case 'read':
      return true
    case 'write':
      return userPermission === 'write' || userPermission === 'admin'
    case 'admin':
      return userPermission === 'admin'
    default:
      return false
  }
}

async function getTableRowCount(tableId: string): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(userTableRows)
    .where(eq(userTableRows.tableId, tableId))

  return Number(result?.count ?? 0)
}

export function errorResponse(
  message: string,
  status: number,
  details?: unknown
): NextResponse<ApiErrorResponse> {
  const body: ApiErrorResponse = { error: message }
  if (details !== undefined) {
    body.details = details
  }
  return NextResponse.json(body, { status })
}

export function badRequestResponse(
  message: string,
  details?: unknown
): NextResponse<ApiErrorResponse> {
  return errorResponse(message, 400, details)
}

export function unauthorizedResponse(
  message = 'Authentication required'
): NextResponse<ApiErrorResponse> {
  return errorResponse(message, 401)
}

export function forbiddenResponse(message = 'Access denied'): NextResponse<ApiErrorResponse> {
  return errorResponse(message, 403)
}

export function notFoundResponse(message = 'Resource not found'): NextResponse<ApiErrorResponse> {
  return errorResponse(message, 404)
}

export function serverErrorResponse(
  message = 'Internal server error'
): NextResponse<ApiErrorResponse> {
  return errorResponse(message, 500)
}

export function normalizeColumn(col: ColumnDefinition): ColumnDefinition {
  return {
    name: col.name,
    type: col.type,
    required: col.required ?? false,
    unique: col.unique ?? false,
  }
}
