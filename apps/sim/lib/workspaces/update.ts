import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'

type WorkspaceRow = typeof workspace.$inferSelect

export interface WorkspaceUpdatePatch {
  name?: string
  logoUrl?: string | null
  allowPersonalApiKeys?: boolean
}

export interface WorkspaceIdentity {
  id: string
  name: string
  logoUrl: string | null
}

export interface WorkspaceUpdateResult {
  previous: WorkspaceRow
  updated: WorkspaceRow
}

/** The name and logo of an active workspace. */
export async function readWorkspaceIdentityRecord(workspaceId: string): Promise<WorkspaceIdentity> {
  const [row] = await db
    .select({ id: workspace.id, name: workspace.name, logoUrl: workspace.logoUrl })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
    .limit(1)
  if (!row) throw new OrchestrationError('not_found', 'Workspace not found')
  return row
}

/**
 * Applies a workspace metadata patch to an active workspace. The billed account
 * is deliberately not patchable here: workspace admin does not carry authority
 * over the payer's pooled credit and storage.
 */
export async function applyWorkspaceUpdate(
  workspaceId: string,
  patch: WorkspaceUpdatePatch
): Promise<WorkspaceUpdateResult> {
  const { name, logoUrl, allowPersonalApiKeys } = patch
  if (name === undefined && logoUrl === undefined && allowPersonalApiKeys === undefined) {
    throw new OrchestrationError('validation', 'No updates provided')
  }

  const [previous] = await db
    .select()
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
    .limit(1)
  if (!previous) throw new OrchestrationError('not_found', 'Workspace not found')

  const updateData: Partial<WorkspaceRow> = { updatedAt: new Date() }
  if (name !== undefined) updateData.name = name
  if (logoUrl !== undefined) updateData.logoUrl = logoUrl
  if (allowPersonalApiKeys !== undefined) updateData.allowPersonalApiKeys = allowPersonalApiKeys

  // Writes only while still active: an archival that commits after the read above
  // leaves no row to update and answers the same not-found.
  const [updated] = await db
    .update(workspace)
    .set(updateData)
    .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
    .returning()
  if (!updated) throw new OrchestrationError('not_found', 'Workspace not found')

  return { previous, updated }
}
