import { db } from '@sim/db'
import { mothershipMemorySelections, mothershipMemorySpaces } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, asc, eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import { isMemorySpacesEnabled } from '@/lib/mothership/feature-flags'
import { lockActiveWorkspace } from '@/lib/workspaces/active-workspace'

interface MemoryOwner {
  userId: string
  organizationId: string
}

export async function listMemorySpaceRecords(owner: MemoryOwner) {
  return db.transaction(
    async (tx) => {
      const [spaces, selection] = await Promise.all([
        tx
          .select({ id: mothershipMemorySpaces.id, name: mothershipMemorySpaces.name })
          .from(mothershipMemorySpaces)
          .where(
            and(
              eq(mothershipMemorySpaces.userId, owner.userId),
              eq(mothershipMemorySpaces.organizationId, owner.organizationId)
            )
          )
          .orderBy(asc(mothershipMemorySpaces.createdAt), asc(mothershipMemorySpaces.id)),
        tx
          .select({ spaceId: mothershipMemorySelections.spaceId })
          .from(mothershipMemorySelections)
          .where(
            and(
              eq(mothershipMemorySelections.userId, owner.userId),
              eq(mothershipMemorySelections.organizationId, owner.organizationId)
            )
          )
          .limit(1),
      ])
      return {
        spaces: [{ id: null, name: 'Default' }, ...spaces],
        activeSpaceId: selection[0]?.spaceId ?? null,
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' }
  )
}

export async function changeMemorySpace(
  owner: MemoryOwner,
  change: { name: string } | { spaceId: string | null }
) {
  return db.transaction(async (tx) => {
    const where = and(
      eq(mothershipMemorySelections.userId, owner.userId),
      eq(mothershipMemorySelections.organizationId, owner.organizationId)
    )
    await tx.insert(mothershipMemorySelections).values(owner).onConflictDoNothing()
    await tx.select().from(mothershipMemorySelections).where(where).for('update')
    let spaceId: string | null
    if ('name' in change) {
      const name = change.name.trim()
      if (!name || name.length > 100 || name.toLowerCase() === 'default')
        throw new OrchestrationError(
          'validation',
          'Choose a name of 1–100 characters other than Default'
        )
      spaceId = generateId()
      await tx.insert(mothershipMemorySpaces).values({ ...owner, id: spaceId, name })
    } else {
      spaceId = change.spaceId
      if (spaceId) {
        const [space] = await tx
          .select({ id: mothershipMemorySpaces.id })
          .from(mothershipMemorySpaces)
          .where(
            and(
              eq(mothershipMemorySpaces.id, spaceId),
              eq(mothershipMemorySpaces.userId, owner.userId),
              eq(mothershipMemorySpaces.organizationId, owner.organizationId)
            )
          )
        if (!space) throw new OrchestrationError('not_found', 'Knowledge graph not found')
      }
    }
    await tx.update(mothershipMemorySelections).set({ spaceId }).where(where)
    return { activeSpaceId: spaceId }
  })
}

/** Call only after authorizing chat creation; the browser never supplies the graph binding. */
export async function selectedMemorySpaceForNewChat(
  userId: string,
  organizationId?: string | null,
  workspaceId?: string | null,
  tx?: DbTransaction
): Promise<string | null> {
  if (!(await isMemorySpacesEnabled(userId, tx))) return null
  let ownerOrganizationId = organizationId
  if (workspaceId) {
    if (!tx) throw new Error('Workspace graph binding requires the chat creation transaction')
    const current = await lockActiveWorkspace(tx, workspaceId)
    if (organizationId !== undefined && organizationId !== current.organizationId)
      throw new OrchestrationError('conflict', 'Workspace organization changed. Refresh and retry.')
    ownerOrganizationId = current.organizationId
  }
  if (!ownerOrganizationId) return null
  const [selected] = await (tx ?? db)
    .select({ spaceId: mothershipMemorySelections.spaceId })
    .from(mothershipMemorySelections)
    .where(
      and(
        eq(mothershipMemorySelections.userId, userId),
        eq(mothershipMemorySelections.organizationId, ownerOrganizationId)
      )
    )
    .limit(1)
  return selected?.spaceId ?? null
}

/** Bound chats keep their namespace even when the management UI is disabled. */
export async function requireOwnedMemorySpace(owner: MemoryOwner, spaceId: string): Promise<void> {
  const [space] = await db
    .select({ id: mothershipMemorySpaces.id })
    .from(mothershipMemorySpaces)
    .where(
      and(
        eq(mothershipMemorySpaces.id, spaceId),
        eq(mothershipMemorySpaces.userId, owner.userId),
        eq(mothershipMemorySpaces.organizationId, owner.organizationId)
      )
    )
  if (!space) throw new OrchestrationError('not_found', 'Knowledge graph not found')
}
