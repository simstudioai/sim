import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { permissions, permissionTypeEnum } from '@/db/schema'

// Extract the enum type from Drizzle schema
export type PermissionType = typeof permissionTypeEnum.enumValues[number]

/**
 * Query permissions for a specific user on a specific entity
 * 
 * @param userId - The ID of the user to check permissions for
 * @param entityType - The type of entity (e.g., 'workspace', 'workflow', etc.)
 * @param entityId - The ID of the specific entity
 * @returns Promise<PermissionType[]> - Array of permissions the user has for the entity
 */
export async function getUserEntityPermissions(
  userId: string,
  entityType: string,
  entityId: string
): Promise<PermissionType[]> {
  const result = await db
    .select({ permissionType: permissions.permissionType })
    .from(permissions)
    .where(and(
      eq(permissions.userId, userId),
      eq(permissions.entityType, entityType),
      eq(permissions.entityId, entityId)
    ))
  
  return result.map(p => p.permissionType)
}
