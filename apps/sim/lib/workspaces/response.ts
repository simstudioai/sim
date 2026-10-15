import type { workspace } from '@sim/db/schema'
import type { Workspace } from '@/lib/api/contracts/workspaces'

/** Projects internal workspace metadata without exposing additional storage columns. */
export function presentWorkspace(row: typeof workspace.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    logoUrl: row.logoUrl,
    ownerId: row.ownerId,
    organizationId: row.organizationId,
    workspaceMode: row.workspaceMode,
    billedAccountUserId: row.billedAccountUserId,
    storageUsedBytes: row.storageUsedBytes,
    allowPersonalApiKeys: row.allowPersonalApiKeys,
    inboxEnabled: row.inboxEnabled,
    inboxAddress: row.inboxAddress,
    inboxProviderId: row.inboxProviderId,
    inboxSecretScope: row.inboxSecretScope,
    inboxMountedSecrets: row.inboxMountedSecrets,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    organizationAssignedAt: row.organizationAssignedAt?.toISOString() ?? null,
    forkedFromWorkspaceId: row.forkedFromWorkspaceId,
    forkSyncNewWorkflowsExcluded: row.forkSyncNewWorkflowsExcluded,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  } satisfies Workspace
}
