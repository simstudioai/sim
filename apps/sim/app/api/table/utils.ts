import { db } from '@sim/db'
import { userTableDefinitions } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

/**
 * Represents the core data structure for a user-defined table.
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
  schema: TableSchemaData
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
 * Schema structure for table columns stored in the database.
 */
export interface TableSchemaData {
  /** Array of column definitions */
  columns: TableColumnData[]
}

/**
 * Represents a single column definition in the table schema.
 */
export interface TableColumnData {
  /** Name of the column */
  name: string
  /** Data type of the column */
  type: 'string' | 'number' | 'boolean' | 'date' | 'json'
  /** Whether this column is required */
  required?: boolean
  /** Whether this column must have unique values */
  unique?: boolean
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
