import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { WorkspaceAuthorizationContext } from '@/lib/core/application'

export interface ActiveWorkspaceApplicationContext extends WorkspaceAuthorizationContext {
  billedAccountUserId: string
}

/** Loads canonical workspace state required by application authorization. */
export async function loadWorkspaceApplicationContext(
  workspaceId: string,
  options: { includeArchived?: boolean } = {}
): Promise<ActiveWorkspaceApplicationContext | null> {
  const [row] = await db
    .select({
      id: workspace.id,
      organizationId: workspace.organizationId,
      allowPersonalApiKeys: workspace.allowPersonalApiKeys,
      billedAccountUserId: workspace.billedAccountUserId,
    })
    .from(workspace)
    .where(
      and(
        eq(workspace.id, workspaceId),
        options.includeArchived ? undefined : isNull(workspace.archivedAt)
      )
    )
    .limit(1)

  if (!row) return null
  return {
    workspaceId: row.id,
    workspaceOrganizationId: row.organizationId,
    allowPersonalApiKeys: row.allowPersonalApiKeys,
    billedAccountUserId: row.billedAccountUserId,
  }
}

/** Loads active canonical workspace state required by application authorization. */
export async function loadActiveWorkspaceApplicationContext(
  workspaceId: string
): Promise<ActiveWorkspaceApplicationContext | null> {
  return loadWorkspaceApplicationContext(workspaceId)
}
