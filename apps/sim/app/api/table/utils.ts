import { db } from '@sim/db'
import { userTableDefinitions } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import type { ColumnDefinition, TableSchema } from '@/lib/table'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('TableUtils')

/**
 * Represents the core data structure for a user-defined table as stored in the database.
 *
 * This extends the base TableDefinition with DB-specific fields like createdBy and deletedAt.
 */
export interface TableData {
  /** Unique identifier for the table */
  id: string
  /** ID of the workspace this table belongs to */
  workspaceId: string
  /** ID of the user who created this table */
  createdBy: string
  /** Human-readable name of the table */
  name: string
  /** Optional description of the table's purpose */
  description?: string | null
  /** JSON schema defining the table's column structure */
  schema: TableSchema
  /** Maximum number of rows allowed in this table */
  maxRows: number
  /** Current number of rows in the table */
  rowCount: number
  /** Timestamp when the table was soft-deleted, if applicable */
  deletedAt?: Date | null
  /** Timestamp when the table was created */
  createdAt: Date
  /** Timestamp when the table was last updated */
  updatedAt: Date
}

/**
 * Result returned when a user has access to a table.
 */
export interface TableAccessResult {
  /** Indicates the user has access */
  hasAccess: true
  /** Core table information needed for access control */
  table: Pick<TableData, 'id' | 'workspaceId' | 'createdBy'>
}

/**
 * Result returned when a user has access to a table with full data.
 */
export interface TableAccessResultFull {
  /** Indicates the user has access */
  hasAccess: true
  /** Full table data */
  table: TableData
}

/**
 * Result returned when a user is denied access to a table.
 */
export interface TableAccessDenied {
  /** Indicates the user does not have access */
  hasAccess: false
  /** True if the table was not found */
  notFound?: boolean
  /** Optional reason for denial */
  reason?: string
}

/**
 * Union type for table access check results.
 */
export type TableAccessCheck = TableAccessResult | TableAccessDenied

/**
 * Permission level required for table access.
 * - 'read': Any workspace permission (read, write, or admin)
 * - 'write': Write or admin permission required
 * - 'admin': Admin permission required
 */
export type TablePermissionLevel = 'read' | 'write' | 'admin'

/**
 * Internal function to check if a user has the required permission level for a table.
 *
 * Access is granted if:
 * 1. User created the table directly, OR
 * 2. User has the required permission level on the table's workspace
 *
 * @param tableId - The unique identifier of the table to check
 * @param userId - The unique identifier of the user requesting access
 * @param requiredLevel - The minimum permission level required ('read', 'write', or 'admin')
 * @returns A promise resolving to the access check result
 *
 * @internal
 */
async function checkTableAccessInternal(
  tableId: string,
  userId: string,
  requiredLevel: TablePermissionLevel
): Promise<TableAccessCheck> {
  // Fetch table data
  const table = await db
    .select({
      id: userTableDefinitions.id,
      createdBy: userTableDefinitions.createdBy,
      workspaceId: userTableDefinitions.workspaceId,
    })
    .from(userTableDefinitions)
    .where(and(eq(userTableDefinitions.id, tableId), isNull(userTableDefinitions.deletedAt)))
    .limit(1)

  if (table.length === 0) {
    return { hasAccess: false, notFound: true }
  }

  const tableData = table[0]

  // Case 1: User created the table directly (always has full access)
  if (tableData.createdBy === userId) {
    return { hasAccess: true, table: tableData }
  }

  // Case 2: Check workspace permissions
  const userPermission = await getUserEntityPermissions(userId, 'workspace', tableData.workspaceId)

  if (userPermission === null) {
    return { hasAccess: false }
  }

  // Determine if user has sufficient permission level
  const hasAccess = (() => {
    switch (requiredLevel) {
      case 'read':
        // Any permission level grants read access
        return true
      case 'write':
        // Write or admin permission required
        return userPermission === 'write' || userPermission === 'admin'
      case 'admin':
        // Only admin permission grants admin access
        return userPermission === 'admin'
      default:
        return false
    }
  })()

  if (hasAccess) {
    return { hasAccess: true, table: tableData }
  }

  return { hasAccess: false }
}

/**
 * Checks if a user has read access to a table.
 *
 * Access is granted if:
 * 1. User created the table directly, OR
 * 2. User has any permission (read/write/admin) on the table's workspace
 *
 * @param tableId - The unique identifier of the table to check
 * @param userId - The unique identifier of the user requesting access
 * @returns A promise resolving to the access check result
 *
 * @example
 * ```typescript
 * const accessCheck = await checkTableAccess(tableId, userId)
 * if (!accessCheck.hasAccess) {
 *   if ('notFound' in accessCheck && accessCheck.notFound) {
 *     return NotFoundResponse()
 *   }
 *   return ForbiddenResponse()
 * }
 * // User has access, proceed with operation
 * ```
 */
export async function checkTableAccess(tableId: string, userId: string): Promise<TableAccessCheck> {
  return checkTableAccessInternal(tableId, userId, 'read')
}

/**
 * Checks if a user has write access to a table.
 *
 * Write access is granted if:
 * 1. User created the table directly, OR
 * 2. User has write or admin permissions on the table's workspace
 *
 * @param tableId - The unique identifier of the table to check
 * @param userId - The unique identifier of the user requesting write access
 * @returns A promise resolving to the access check result
 *
 * @example
 * ```typescript
 * const accessCheck = await checkTableWriteAccess(tableId, userId)
 * if (!accessCheck.hasAccess) {
 *   return ForbiddenResponse()
 * }
 * // User has write access, proceed with modification
 * ```
 */
export async function checkTableWriteAccess(
  tableId: string,
  userId: string
): Promise<TableAccessCheck> {
  return checkTableAccessInternal(tableId, userId, 'write')
}

/**
 * Checks table access and returns either the access result or an error response.
 *
 * This is a convenience function that combines access checking with automatic
 * error response generation, reducing boilerplate in route handlers.
 *
 * @param tableId - The unique identifier of the table to check
 * @param userId - The unique identifier of the user requesting access
 * @param requestId - Request ID for logging
 * @param level - Permission level required ('read' or 'write')
 * @returns Either a TableAccessResult with table info, or a NextResponse with error
 *
 * @example
 * ```typescript
 * const accessResult = await checkAccessOrRespond(tableId, userId, requestId, 'write')
 * if (accessResult instanceof NextResponse) return accessResult
 *
 * // Access granted - use accessResult.table
 * const { table } = accessResult
 * ```
 */
export async function checkAccessOrRespond(
  tableId: string,
  userId: string,
  requestId: string,
  level: TablePermissionLevel = 'write'
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

/**
 * Checks table access and returns full table data or an error response.
 *
 * This is an optimized version of checkAccessOrRespond that fetches the full
 * table data in a single query, avoiding a redundant getTableById call.
 *
 * @param tableId - The unique identifier of the table to check
 * @param userId - The unique identifier of the user requesting access
 * @param requestId - Request ID for logging
 * @param level - Permission level required ('read' or 'write')
 * @returns Either a TableAccessResultFull with full table data, or a NextResponse with error
 *
 * @example
 * ```typescript
 * const result = await checkAccessWithFullTable(tableId, userId, requestId, 'write')
 * if (result instanceof NextResponse) return result
 *
 * // Access granted - use result.table which has full table data
 * const schema = result.table.schema
 * const rowCount = result.table.rowCount
 * ```
 */
export async function checkAccessWithFullTable(
  tableId: string,
  userId: string,
  requestId: string,
  level: TablePermissionLevel = 'write'
): Promise<TableAccessResultFull | NextResponse> {
  // Fetch full table data in one query
  const [tableData] = await db
    .select()
    .from(userTableDefinitions)
    .where(and(eq(userTableDefinitions.id, tableId), isNull(userTableDefinitions.deletedAt)))
    .limit(1)

  if (!tableData) {
    logger.warn(`[${requestId}] Table not found: ${tableId}`)
    return NextResponse.json({ error: 'Table not found' }, { status: 404 })
  }

  const table = tableData as unknown as TableData

  // Case 1: User created the table directly (always has full access)
  if (table.createdBy === userId) {
    return { hasAccess: true, table }
  }

  // Case 2: Check workspace permissions
  const userPermission = await getUserEntityPermissions(userId, 'workspace', table.workspaceId)

  if (userPermission === null) {
    logger.warn(`[${requestId}] User ${userId} denied ${level} access to table ${tableId}`)
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Determine if user has sufficient permission level
  const hasAccess = (() => {
    switch (level) {
      case 'read':
        return true
      case 'write':
        return userPermission === 'write' || userPermission === 'admin'
      case 'admin':
        return userPermission === 'admin'
      default:
        return false
    }
  })()

  if (!hasAccess) {
    logger.warn(`[${requestId}] User ${userId} denied ${level} access to table ${tableId}`)
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  return { hasAccess: true, table }
}

/**
 * Fetches a table by ID with soft-delete awareness.
 *
 * @param tableId - The unique identifier of the table to fetch
 * @returns Promise resolving to table data or null if not found/deleted
 *
 * @example
 * ```typescript
 * const table = await getTableById(tableId)
 * if (!table) {
 *   return NextResponse.json({ error: 'Table not found' }, { status: 404 })
 * }
 * ```
 */
export async function getTableById(tableId: string): Promise<TableData | null> {
  const [table] = await db
    .select()
    .from(userTableDefinitions)
    .where(and(eq(userTableDefinitions.id, tableId), isNull(userTableDefinitions.deletedAt)))
    .limit(1)

  if (!table) {
    return null
  }

  return table as unknown as TableData
}

/**
 * Verifies that a table belongs to a specific workspace.
 *
 * This is a security check to prevent workspace ID spoofing.
 * Use this when workspaceId is provided as a parameter to ensure
 * it matches the table's actual workspace.
 *
 * @param tableId - The unique identifier of the table
 * @param workspaceId - The workspace ID to verify against
 * @returns A promise resolving to true if the table belongs to the workspace
 *
 * @example
 * ```typescript
 * if (providedWorkspaceId) {
 *   const isValid = await verifyTableWorkspace(tableId, providedWorkspaceId)
 *   if (!isValid) {
 *     return BadRequestResponse('Invalid workspace ID')
 *   }
 * }
 * ```
 */
export async function verifyTableWorkspace(tableId: string, workspaceId: string): Promise<boolean> {
  const table = await db
    .select({ workspaceId: userTableDefinitions.workspaceId })
    .from(userTableDefinitions)
    .where(and(eq(userTableDefinitions.id, tableId), isNull(userTableDefinitions.deletedAt)))
    .limit(1)

  if (table.length === 0) {
    return false
  }

  return table[0].workspaceId === workspaceId
}

/**
 * Standard error response structure for table API routes.
 */
export interface ApiErrorResponse {
  error: string
  details?: unknown
}

/**
 * Creates a standardized error response.
 *
 * @param message - Error message to display
 * @param status - HTTP status code
 * @param details - Optional additional error details
 * @returns NextResponse with standardized error format
 *
 * @example
 * ```typescript
 * return errorResponse('Table not found', 404)
 * return errorResponse('Validation error', 400, zodError.errors)
 * ```
 */
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

/**
 * Creates a 400 Bad Request error response.
 */
export function badRequestResponse(
  message: string,
  details?: unknown
): NextResponse<ApiErrorResponse> {
  return errorResponse(message, 400, details)
}

/**
 * Creates a 401 Unauthorized error response.
 */
export function unauthorizedResponse(
  message = 'Authentication required'
): NextResponse<ApiErrorResponse> {
  return errorResponse(message, 401)
}

/**
 * Creates a 403 Forbidden error response.
 */
export function forbiddenResponse(message = 'Access denied'): NextResponse<ApiErrorResponse> {
  return errorResponse(message, 403)
}

/**
 * Creates a 404 Not Found error response.
 */
export function notFoundResponse(message = 'Resource not found'): NextResponse<ApiErrorResponse> {
  return errorResponse(message, 404)
}

/**
 * Creates a 500 Internal Server Error response.
 */
export function serverErrorResponse(
  message = 'Internal server error'
): NextResponse<ApiErrorResponse> {
  return errorResponse(message, 500)
}

/**
 * Normalizes a column definition by ensuring all optional fields have explicit values.
 *
 * @param col - The column definition to normalize
 * @returns A normalized column with explicit required and unique values
 */
export function normalizeColumn(col: ColumnDefinition): ColumnDefinition {
  return {
    name: col.name,
    type: col.type,
    required: col.required ?? false,
    unique: col.unique ?? false,
  }
}
