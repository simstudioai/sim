import { db } from '@sim/db'
import { knowledgeBase } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'

/** Resolves the single active Enterprise Search index owned by a workspace. */
export async function findWorkspaceSearchIndex(workspaceId: string) {
  const [index] = await db
    .select({ id: knowledgeBase.id })
    .from(knowledgeBase)
    .where(
      and(
        eq(knowledgeBase.workspaceId, workspaceId),
        eq(knowledgeBase.isSearchIndex, true),
        isNull(knowledgeBase.deletedAt)
      )
    )
    .limit(1)
  return index ?? null
}
