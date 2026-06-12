import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { NextResponse } from 'next/server'
import {
  createTableColumnBodySchema,
  deleteTableColumnBodySchema,
  updateTableColumnBodySchema,
} from '@/lib/api/contracts/tables'
import type { MultipartError } from '@/lib/core/utils/multipart'
import type { ColumnDefinition, Filter, TableDefinition } from '@/lib/table'
import { buildFilterClause, getTableById, TableQueryValidationError } from '@/lib/table'
import { USER_TABLE_ROWS_SQL_NAME } from '@/lib/table/constants'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

/**
 * Validates a `filter` against the table's column schema, returning a 400 response on a bad field
 * (or `null` when the filter is valid or absent). Shared by the routes that accept a filter
 * (`delete-async`, `columns/run`) so a bad field fails fast with a clear message.
 */
export function tableFilterError(
  filter: Filter | undefined,
  columns: ColumnDefinition[]
): NextResponse | null {
  if (!filter) return null
  try {
    buildFilterClause(filter, USER_TABLE_ROWS_SQL_NAME, columns)
    return null
  } catch (error) {
    if (error instanceof TableQueryValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }
}

const logger = createLogger('TableUtils')

/**
 * Deepest `Error` message in the cause chain. Drizzle wraps DB errors (e.g. the
 * row-limit trigger's RAISE) in a `DrizzleQueryError` whose own message is just
 * the failed SQL — substring classification must look at the root cause.
 */
export function rootErrorMessage(error: unknown): string {
  let current: unknown = error
  while (current instanceof Error && current.cause instanceof Error) {
    current = current.cause
  }
  return toError(current).message
}

/**
 * Known user-facing row-write failures (service validation + the DB row-limit
 * trigger). Anything outside this list stays a generic 500 — unknown errors can
 * carry SQL/internals that don't belong in a toast.
 */
const ROW_WRITE_ERROR_PATTERNS = [
  'row limit',
  'Insufficient capacity',
  'Schema validation',
  'must be unique',
  'must be valid',
  'must be string',
  'must be number',
  'must be boolean',
  'unique column',
  'Unique constraint violation',
  'Row size exceeds',
  'conflictTarget',
  'Upsert requires',
  'Rows not found',
  'Filter is required',
] as const

/**
 * Maps a known user-facing row-write failure to a 400 carrying the real message
 * (so client toasts can show the actual reason); `null` when the error is
 * unrecognized and the caller should log it and return its generic 500.
 */
export function rowWriteErrorResponse(error: unknown): NextResponse | null {
  const message = rootErrorMessage(error)

  // Trigger message reads `Maximum row limit (N) reached for table tbl_...` —
  // rewrite it for the toast instead of leaking the internal table id.
  const limitMatch = message.match(/Maximum row limit \((\d+)\) reached/)
  if (limitMatch) {
    return NextResponse.json(
      {
        error: `Row limit exceeded — this table is capped at ${Number(limitMatch[1]).toLocaleString('en-US')} rows`,
      },
      { status: 400 }
    )
  }

  if (ROW_WRITE_ERROR_PATTERNS.some((p) => message.includes(p)) || /^Row .+?:/.test(message)) {
    return NextResponse.json({ error: message }, { status: 400 })
  }

  return null
}

/**
 * Next.js buffers the request body for the proxy and silently truncates it past this
 * size (`experimental.proxyClientMaxBodySize`, default 10MB). The synchronous CSV
 * import routes reject bodies over the cap up front; larger files use the async
 * direct-to-storage path instead.
 */
export const CSV_IMPORT_PROXY_BODY_CAP_BYTES = 10 * 1024 * 1024

/** 413 response when a synchronous CSV upload would exceed (and be truncated at) the proxy cap; `null` otherwise. */
export function csvProxyBodyCapResponse(request: { headers: Headers }): NextResponse | null {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > CSV_IMPORT_PROXY_BODY_CAP_BYTES) {
    return NextResponse.json(
      {
        error:
          'File too large to import through the server. Files over 10MB import in the background.',
      },
      { status: 413 }
    )
  }
  return null
}

/** Maps a {@link MultipartError} from the streaming CSV parser to its HTTP response. */
export function multipartErrorResponse(error: MultipartError): NextResponse {
  if (error.code === 'FILE_TOO_LARGE') {
    return NextResponse.json({ error: 'CSV import file exceeds maximum size' }, { status: 413 })
  }
  const message =
    error.code === 'NO_FILE' ? 'CSV file is required' : `Invalid CSV upload: ${error.message}`
  return NextResponse.json({ error: message }, { status: 400 })
}

interface TableAccessResult {
  hasAccess: true
  table: TableDefinition
}

interface TableAccessDenied {
  hasAccess: false
  notFound?: boolean
  reason?: string
}

export type TableAccessCheck = TableAccessResult | TableAccessDenied

export type AccessResult = { ok: true; table: TableDefinition } | { ok: false; status: 404 | 403 }

interface ApiErrorResponse {
  error: string
  details?: unknown
}

/**
 * Check if a user has read access to a table.
 * Read access requires any workspace permission (read, write, or admin).
 */
async function checkTableAccess(tableId: string, userId: string): Promise<TableAccessCheck> {
  const table = await getTableById(tableId)

  if (!table) {
    return { hasAccess: false, notFound: true }
  }

  const userPermission = await getUserEntityPermissions(userId, 'workspace', table.workspaceId)
  if (userPermission !== null) {
    return { hasAccess: true, table }
  }

  return { hasAccess: false, reason: 'User does not have access to this table' }
}

/**
 * Check if a user has write access to a table.
 * Write access requires write or admin workspace permission.
 */
async function checkTableWriteAccess(tableId: string, userId: string): Promise<TableAccessCheck> {
  const table = await getTableById(tableId)

  if (!table) {
    return { hasAccess: false, notFound: true }
  }

  const userPermission = await getUserEntityPermissions(userId, 'workspace', table.workspaceId)
  if (userPermission === 'write' || userPermission === 'admin') {
    return { hasAccess: true, table }
  }

  return { hasAccess: false, reason: 'User does not have write access to this table' }
}

/**
 * Access check returning `{ ok, table }` or `{ ok: false, status }`.
 * Uses workspace permissions only.
 */
export async function checkAccess(
  tableId: string,
  userId: string,
  level: 'read' | 'write' | 'admin' = 'read'
): Promise<AccessResult> {
  const table = await getTableById(tableId)

  if (!table) {
    return { ok: false, status: 404 }
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

/**
 * Converts a TableAccessDenied result to an appropriate HTTP response.
 * Use with checkTableAccess or checkTableWriteAccess.
 */
export function tableAccessError(
  result: TableAccessDenied,
  requestId: string,
  context?: string
): NextResponse {
  const status = result.notFound ? 404 : 403
  const message = result.notFound ? 'Table not found' : (result.reason ?? 'Access denied')
  logger.warn(`[${requestId}] ${message}${context ? `: ${context}` : ''}`)
  return NextResponse.json({ error: message }, { status })
}

async function verifyTableWorkspace(tableId: string, workspaceId: string): Promise<boolean> {
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

/**
 * Re-exports from `lib/api/contracts/tables` so existing routes that import
 * these names keep working while sharing a single source of truth.
 */
export const CreateColumnSchema = createTableColumnBodySchema
export const UpdateColumnSchema = updateTableColumnBodySchema
export const DeleteColumnSchema = deleteTableColumnBodySchema

export function normalizeColumn(col: ColumnDefinition): ColumnDefinition {
  return {
    // Preserve the stable column id — it's the row-data storage key, so dropping
    // it makes clients fall back to `name` and miss id-keyed cell values.
    ...(col.id ? { id: col.id } : {}),
    name: col.name,
    type: col.type,
    required: col.required ?? false,
    unique: col.unique ?? false,
    ...(col.options !== undefined ? { options: col.options } : {}),
    ...(col.workflowGroupId ? { workflowGroupId: col.workflowGroupId } : {}),
  }
}
