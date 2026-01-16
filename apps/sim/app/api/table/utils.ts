import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import type { ColumnDefinition, TableDefinition } from '@/lib/table'
import { getTableById } from '@/lib/table'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('TableUtils')

export type AccessResult = { ok: true; table: TableDefinition } | { ok: false; status: 404 | 403 }

export interface ApiErrorResponse {
  error: string
  details?: unknown
}

export async function checkAccess(
  tableId: string,
  userId: string,
  level: 'read' | 'write' | 'admin' = 'read'
): Promise<AccessResult> {
  const table = await getTableById(tableId)

  if (!table) {
    return { ok: false, status: 404 }
  }

  if (table.createdBy === userId) {
    return { ok: true, table }
  }

  const permission = await getUserEntityPermissions(userId, 'workspace', table.workspaceId)
  const hasAccess =
    permission !== null &&
    (level === 'read' ||
      (level === 'write' && (permission === 'write' || permission === 'admin')) ||
      (level === 'admin' && permission === 'admin'))

  return hasAccess ? { ok: true, table } : { ok: false, status: 403 }
}

export function accessError(
  result: { ok: false; status: 404 | 403 },
  requestId: string,
  context?: string
): NextResponse {
  const message = result.status === 404 ? 'Table not found' : 'Access denied'
  logger.warn(`[${requestId}] ${message}${context ? `: ${context}` : ''}`)
  return NextResponse.json({ error: message }, { status: result.status })
}

export async function verifyTableWorkspace(tableId: string, workspaceId: string): Promise<boolean> {
  const table = await getTableById(tableId)
  return table?.workspaceId === workspaceId
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

export function badRequestResponse(message: string, details?: unknown) {
  return errorResponse(message, 400, details)
}

export function unauthorizedResponse(message = 'Authentication required') {
  return errorResponse(message, 401)
}

export function forbiddenResponse(message = 'Access denied') {
  return errorResponse(message, 403)
}

export function notFoundResponse(message = 'Resource not found') {
  return errorResponse(message, 404)
}

export function serverErrorResponse(message = 'Internal server error') {
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
