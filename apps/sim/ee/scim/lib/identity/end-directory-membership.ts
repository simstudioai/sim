import { scimConnection, scimUser, scimUserTombstone, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

/**
 * What ending an organization membership means to the directory.
 *
 * Called from inside the removal transaction, whoever started it — the settings
 * UI, an administrator API, or a SCIM DELETE — so a member can never be gone
 * while their directory row says otherwise. The row is replaced by a tombstone
 * keyed by the directory's external id, which is what lets a later recreate
 * relink the same account, and a suspension the directory applied ends with the
 * membership it was scoped to.
 *
 * Imports only schema so the membership primitive can depend on it without a
 * module cycle.
 */
export async function endDirectoryMembershipTx(
  tx: DbOrTx,
  params: { userId: string; organizationId: string }
): Promise<{ removed: number }> {
  const rows = await tx
    .select({
      id: scimUser.id,
      connectionId: scimUser.connectionId,
      externalId: scimUser.externalId,
    })
    .from(scimUser)
    .innerJoin(scimConnection, eq(scimConnection.id, scimUser.connectionId))
    .where(
      and(
        eq(scimUser.userId, params.userId),
        eq(scimConnection.organizationId, params.organizationId)
      )
    )
  if (rows.length === 0) return { removed: 0 }

  for (const row of rows) {
    if (!row.externalId) continue
    await tx
      .insert(scimUserTombstone)
      .values({
        id: generateId(),
        connectionId: row.connectionId,
        externalId: row.externalId,
        userId: params.userId,
        deletedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [scimUserTombstone.connectionId, scimUserTombstone.externalId],
        set: { userId: params.userId, deletedAt: new Date() },
      })
  }

  await tx.delete(scimUser).where(
    inArray(
      scimUser.id,
      rows.map((row) => row.id)
    )
  )

  await tx
    .update(user)
    .set({ suspendedAt: null, suspensionSource: null, updatedAt: new Date() })
    .where(and(eq(user.id, params.userId), eq(user.suspensionSource, 'scim')))

  return { removed: rows.length }
}
