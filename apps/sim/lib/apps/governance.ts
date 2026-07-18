import { db } from '@sim/db'
import { appBuild, appProject } from '@sim/db/schema'
import { and, eq, gte, sql } from 'drizzle-orm'

/** Soft Phase 1 build quota per workspace (per calendar day). */
export const APP_BUILD_DAILY_QUOTA = 50

export async function assertBuildQuota(
  workspaceId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const dayStart = new Date()
  dayStart.setUTCHours(0, 0, 0, 0)

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(appBuild)
    .innerJoin(appProject, eq(appBuild.projectId, appProject.id))
    .where(and(eq(appProject.workspaceId, workspaceId), gte(appBuild.createdAt, dayStart)))

  if ((row?.count ?? 0) >= APP_BUILD_DAILY_QUOTA) {
    return {
      ok: false,
      error: `Workspace exceeded daily app build quota (${APP_BUILD_DAILY_QUOTA})`,
    }
  }
  return { ok: true }
}
