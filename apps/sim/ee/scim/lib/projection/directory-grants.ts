import { scimGroupMapping, scimGroupMember, scimProjectionGrant } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import type {
  MappingRow,
  ProjectionGrant,
  ProjectionGrantOrigin,
  ProjectionTargetKind,
} from '@/ee/scim/lib/projection/grants'

/**
 * What reconciliation reads for one directory user: the grants their groups'
 * mappings call for, and the grants it has already applied and still tracks.
 * Shared with the managed-membership guard so both agree on what the directory owns.
 */

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

/** The grants reconciliation applied for this user and has not yet withdrawn. */
export async function currentGrants(tx: DbOrTx, scimUserId: string): Promise<ProjectionGrant[]> {
  const rows = await tx
    .select({
      targetKind: scimProjectionGrant.targetKind,
      targetId: scimProjectionGrant.targetId,
      permissionType: scimProjectionGrant.permissionType,
      origin: scimProjectionGrant.origin,
      baselinePermission: scimProjectionGrant.baselinePermission,
    })
    .from(scimProjectionGrant)
    .where(eq(scimProjectionGrant.scimUserId, scimUserId))
  return rows.map((row) => ({
    targetKind: row.targetKind as ProjectionTargetKind,
    targetId: row.targetId,
    origin: row.origin as ProjectionGrantOrigin,
    baselinePermission: row.baselinePermission ?? null,
    ...(row.permissionType ? { permissionType: row.permissionType } : {}),
  }))
}
