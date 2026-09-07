import { permissionGroup, scimGroupMapping } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, ne } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

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
 * its last member narrows it to nobody instead of widening it to everyone.
 *
 * Automatic mappings are the ones with no author. A rename drops the automatic
 * mapping the old name earned, so members do not keep access to a group whose
 * name the directory no longer carries; mappings an administrator made by hand
 * are theirs and are left alone.
 */
export async function autoMapPermissionGroupByName(
  tx: DbOrTx,
  params: { organizationId: string; scimGroupId: string; displayName: string }
): Promise<'mapped' | 'already-mapped' | 'no-match'> {
  const [target] = await tx
    .select({ id: permissionGroup.id, membershipMode: permissionGroup.membershipMode })
    .from(permissionGroup)
    .where(
      and(
        eq(permissionGroup.organizationId, params.organizationId),
        eq(permissionGroup.name, params.displayName),
        eq(permissionGroup.isDefault, false)
      )
    )
    .limit(1)

  await tx
    .delete(scimGroupMapping)
    .where(
      and(
        eq(scimGroupMapping.groupId, params.scimGroupId),
        eq(scimGroupMapping.targetKind, 'permission_group'),
        isNull(scimGroupMapping.createdBy),
        ...(target ? [ne(scimGroupMapping.permissionGroupId, target.id)] : [])
      )
    )
  if (!target) return 'no-match'

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

  if (target.membershipMode !== 'explicit') {
    await tx
      .update(permissionGroup)
      .set({ membershipMode: 'explicit', updatedAt: new Date() })
      .where(eq(permissionGroup.id, target.id))
  }

  /** The unique index is the arbiter when an administrator maps the same pair concurrently. */
  const inserted = await tx
    .insert(scimGroupMapping)
    .values({
      id: generateId(),
      groupId: params.scimGroupId,
      targetKind: 'permission_group',
      permissionGroupId: target.id,
      createdBy: null,
    })
    .onConflictDoNothing()
    .returning({ id: scimGroupMapping.id })
  return inserted.length > 0 ? 'mapped' : 'already-mapped'
}
