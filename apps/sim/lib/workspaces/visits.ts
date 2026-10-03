import { db } from '@sim/db'
import { workspaceVisit } from '@sim/db/schema'
import { asc, desc, eq, sql } from 'drizzle-orm'

/**
 * Stamps the user's visit to a workspace with the database clock, so visits
 * handled by different app servers order consistently. Callers must prove
 * workspace access first.
 */
export async function recordWorkspaceVisitRecord(
  userId: string,
  workspaceId: string
): Promise<void> {
  await db
    .insert(workspaceVisit)
    .values({ userId, workspaceId })
    .onConflictDoUpdate({
      target: [workspaceVisit.userId, workspaceVisit.workspaceId],
      set: { visitedAt: sql`now()` },
    })
}

/** The user's visited workspace ids, most recent first. */
export async function listRecentWorkspaceIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ workspaceId: workspaceVisit.workspaceId })
    .from(workspaceVisit)
    .where(eq(workspaceVisit.userId, userId))
    .orderBy(desc(workspaceVisit.visitedAt), asc(workspaceVisit.workspaceId))
  return rows.map((row) => row.workspaceId)
}

/**
 * Orders workspaces most recently visited first, keeping never-visited ones
 * after them in their incoming order.
 */
export function sortByVisitRecency<T extends { id: string }>(
  workspaces: T[],
  recentIds: readonly string[]
): T[] {
  const rank = new Map(recentIds.map((id, index) => [id, index]))
  const unvisited = rank.size
  return [...workspaces].sort(
    (a, b) => (rank.get(a.id) ?? unvisited) - (rank.get(b.id) ?? unvisited)
  )
}
