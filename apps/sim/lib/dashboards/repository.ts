import { db } from '@sim/db'
import { dashboard } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, sql } from 'drizzle-orm'

export type DashboardRow = typeof dashboard.$inferSelect

/** The workspace's dashboard; the unique workspace index allows at most one. */
export async function getWorkspaceDashboard(workspaceId: string): Promise<DashboardRow | null> {
  const [row] = await db
    .select()
    .from(dashboard)
    .where(eq(dashboard.workspaceId, workspaceId))
    .limit(1)
  return row ?? null
}

/** Creates the workspace's dashboard; null when the workspace already has one. */
export async function insertWorkspaceDashboard(
  workspaceId: string,
  content: string,
  userId: string
): Promise<DashboardRow | null> {
  const [row] = await db
    .insert(dashboard)
    .values({ id: generateId(), workspaceId, content, createdBy: userId, updatedBy: userId })
    .onConflictDoNothing({ target: dashboard.workspaceId })
    .returning()
  return row ?? null
}

/** Replaces a dashboard's content only while its revision still matches; null otherwise. */
export async function updateDashboardContent(
  dashboardId: string,
  content: string,
  userId: string,
  expectedRevision: number
): Promise<DashboardRow | null> {
  const [row] = await db
    .update(dashboard)
    .set({
      content,
      updatedBy: userId,
      updatedAt: new Date(),
      revision: sql`${dashboard.revision} + 1`,
    })
    .where(and(eq(dashboard.id, dashboardId), eq(dashboard.revision, expectedRevision)))
    .returning()
  return row ?? null
}
