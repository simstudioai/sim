import { scimGroupMapping, scimGroupMember } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import type { MappingRow } from '@/ee/scim/lib/projection/grants'

/**
 * The mapping rows this user reaches through their groups.
 *
 * Deliberately independent of whether the user is active. A deactivation blocks
 * sign-in and API keys through suspension; it does not withdraw grants, because
 * withdrawing a workspace grant reassigns the workflows the person owns there,
 * and that cannot be undone by reactivating them. Grants change only when group
 * membership or mappings change, or when the user is deprovisioned outright.
 */
export async function loadMappingRows(tx: DbOrTx, scimUserId: string): Promise<MappingRow[]> {
  return tx
    .select({
      targetKind: scimGroupMapping.targetKind,
      permissionGroupId: scimGroupMapping.permissionGroupId,
      workspaceId: scimGroupMapping.workspaceId,
      permissionType: scimGroupMapping.permissionType,
      role: scimGroupMapping.role,
    })
    .from(scimGroupMember)
    .innerJoin(scimGroupMapping, eq(scimGroupMapping.groupId, scimGroupMember.groupId))
    .where(eq(scimGroupMember.scimUserId, scimUserId))
}
