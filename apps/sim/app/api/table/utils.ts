import { db } from '@sim/db'
import { userTableDefinitions } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

export interface TableData {
  id: string
  workspaceId: string
  createdBy: string
  name: string
  description?: string | null
  schema: unknown
  maxRows: number
  rowCount: number
  deletedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface TableAccessResult {
  hasAccess: true
  table: Pick<TableData, 'id' | 'workspaceId' | 'createdBy'>
}

export interface TableAccessDenied {
  hasAccess: false
  notFound?: boolean
  reason?: string
}

export type TableAccessCheck = TableAccessResult | TableAccessDenied

/**
 * Check if a user has access to a table
 * Access is granted if:
 * 1. User created the table directly, OR
 * 2. User has any permission (read/write/admin) on the table's workspace
 */
export async function checkTableAccess(tableId: string, userId: string): Promise<TableAccessCheck> {
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

  // Case 1: User created the table directly
  if (tableData.createdBy === userId) {
    return { hasAccess: true, table: tableData }
  }

  // Case 2: Table belongs to a workspace the user has permissions for
  const userPermission = await getUserEntityPermissions(userId, 'workspace', tableData.workspaceId)
  if (userPermission !== null) {
    return { hasAccess: true, table: tableData }
  }

  return { hasAccess: false }
}

/**
 * Check if a user has write access to a table
 * Write access is granted if:
 * 1. User created the table directly, OR
 * 2. User has write or admin permissions on the table's workspace
 */
export async function checkTableWriteAccess(
  tableId: string,
  userId: string
): Promise<TableAccessCheck> {
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

  // Case 1: User created the table directly
  if (tableData.createdBy === userId) {
    return { hasAccess: true, table: tableData }
  }

  // Case 2: Table belongs to a workspace and user has write/admin permissions
  const userPermission = await getUserEntityPermissions(userId, 'workspace', tableData.workspaceId)
  if (userPermission === 'write' || userPermission === 'admin') {
    return { hasAccess: true, table: tableData }
  }

  return { hasAccess: false }
}

/**
 * Verify that a table belongs to a specific workspace
 * This is a security check to prevent workspace ID spoofing
 * Use this when workspaceId is provided as a parameter to ensure it matches the table's actual workspace
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
