import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/** Issue rollout follows the canonical organization; personal workspaces use the global switch. */
export function isIssuesEnabled(orgId?: string | null): Promise<boolean> {
  return isFeatureEnabled('issues', orgId ? { orgId } : {})
}

export async function requireIssuesEnabled(orgId?: string | null): Promise<void> {
  if (!(await isIssuesEnabled(orgId))) {
    throw new OrchestrationError('forbidden', 'Issues are not enabled')
  }
}

/** For paths that hold only a workspace id, such as the collaborative editor's seed and persist. */
export async function isIssuesEnabledForWorkspace(workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ organizationId: workspace.organizationId })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)
  return row ? isIssuesEnabled(row.organizationId) : false
}
