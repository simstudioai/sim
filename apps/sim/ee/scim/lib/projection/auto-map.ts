import { permissionGroup, scimGroupMapping } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, ne } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { acquirePermissionGroupOrgLock } from '@/lib/permission-groups/locks'

/**
 * Links a pushed directory group to a permission group of the same name.
 *
 * Every mature provisioning integration adopts the container that matches the
 * pushed group's name rather than waiting for a person to wire it up, because
 * the administrator has usually already created both sides to match. Sim adopts
 * only an existing permission group here and never creates one: a permission
 * group is an access-control decision with an owner, and a directory sync is not
 * the place to make it.
 *
 * The adopted group is moved to explicit membership so the directory removing
 * its last member narrows it to nobody instead of widening it to everyone. That
 * move is a separate step, `settleMappedPermissionGroupsExplicit`, taken after
 * the members' projection: the permission-group lock it needs is a leaf, and
 * the projection takes user locks that must precede it.
 *
 * A rename drops the automatic mapping the old name earned, so members do not
 * keep access to a group whose name the directory no longer carries; mappings an
 * administrator made by hand are theirs and are left alone.
 */
export async function autoMapPermissionGroupByName(
  tx: DbOrTx,
  params: { organizationId: string; scimGroupId: string; displayName: string }
): Promise<'mapped' | 'already-mapped' | 'unmapped' | 'no-match'> {
  const [target] = await tx
    .select({ id: permissionGroup.id })
    .from(permissionGroup)
    .where(
      and(
        eq(permissionGroup.organizationId, params.organizationId),
        eq(permissionGroup.name, params.displayName),
        eq(permissionGroup.isDefault, false)
      )
    )
    .limit(1)

  const removed = await tx
    .delete(scimGroupMapping)
    .where(
      and(
        eq(scimGroupMapping.groupId, params.scimGroupId),
        eq(scimGroupMapping.targetKind, 'permission_group'),
        eq(scimGroupMapping.source, 'automatic'),
        ...(target ? [ne(scimGroupMapping.permissionGroupId, target.id)] : [])
      )
    )
    .returning({ id: scimGroupMapping.id })
  /** `unmapped` tells the caller access changed even though nothing new was mapped. */
  if (!target) return removed.length > 0 ? 'unmapped' : 'no-match'

  const [existing] = await tx
    .select({ id: scimGroupMapping.id })
    .from(scimGroupMapping)
    .where(
      and(
        eq(scimGroupMapping.groupId, params.scimGroupId),
        eq(scimGroupMapping.targetKind, 'permission_group'),
        eq(scimGroupMapping.permissionGroupId, target.id)
      )
    )
    .limit(1)
  if (existing) return 'already-mapped'

  /** The unique index is the arbiter when an administrator maps the same pair concurrently. */
  const inserted = await tx
    .insert(scimGroupMapping)
    .values({
      id: generateId(),
      groupId: params.scimGroupId,
      targetKind: 'permission_group',
      permissionGroupId: target.id,
      source: 'automatic',
      createdBy: null,
    })
    .onConflictDoNothing()
    .returning({ id: scimGroupMapping.id })
  return inserted.length > 0 ? 'mapped' : 'already-mapped'
}

/**
 * Moves every permission group this directory group maps to into explicit
 * membership, so it governs exactly its members from now on.
 *
 * Called once the members' projection has run, because the permission-group
 * lock is a leaf: the projection takes the organization's user locks, and a
 * leaf taken before them would put this transaction on the wrong side of the
 * documented order. Nothing between the mapping and this step observes the
 * mode, and both commit together.
 */
export async function settleMappedPermissionGroupsExplicit(
  tx: DbOrTx,
  params: { organizationId: string; scimGroupId: string }
): Promise<void> {
  const inheriting = await tx
    .select({ id: permissionGroup.id })
    .from(scimGroupMapping)
    .innerJoin(permissionGroup, eq(permissionGroup.id, scimGroupMapping.permissionGroupId))
    .where(
      and(
        eq(scimGroupMapping.groupId, params.scimGroupId),
        eq(scimGroupMapping.targetKind, 'permission_group'),
        eq(permissionGroup.organizationId, params.organizationId),
        ne(permissionGroup.membershipMode, 'explicit')
      )
    )
  if (inheriting.length === 0) return
  await acquirePermissionGroupOrgLock(tx, params.organizationId, {
    lockTimeoutAlreadyBounded: true,
  })
  await tx
    .update(permissionGroup)
    .set({ membershipMode: 'explicit', updatedAt: new Date() })
    .where(
      inArray(
        permissionGroup.id,
        inheriting.map((row) => row.id)
      )
    )
}
