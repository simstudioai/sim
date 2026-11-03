import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { changeWorkspaceStoragePayerInTx } from '@/lib/billing/storage/payer-transfer'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { getEffectiveWorkspacePermission } from '@/lib/workspaces/permissions/utils'

type WorkspaceRow = typeof workspace.$inferSelect

export interface WorkspaceUpdatePatch {
  name?: string
  logoUrl?: string | null
  allowPersonalApiKeys?: boolean
  billedAccountUserId?: string
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
 * Applies a workspace metadata patch to an active workspace. A billed-account
 * change moves the workspace's storage to the new payer in the same transaction.
 */
export async function applyWorkspaceUpdate(
  workspaceId: string,
  patch: WorkspaceUpdatePatch
): Promise<WorkspaceUpdateResult> {
  const { name, logoUrl, allowPersonalApiKeys, billedAccountUserId } = patch
  if (
    name === undefined &&
    logoUrl === undefined &&
    billedAccountUserId === undefined &&
    allowPersonalApiKeys === undefined
  ) {
    throw new OrchestrationError('validation', 'No updates provided')
  }

  const [previous] = await db
    .select()
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
    .limit(1)
  if (!previous) throw new OrchestrationError('not_found', 'Workspace not found')

  const updateData: Partial<WorkspaceRow> = {}
  if (name !== undefined) updateData.name = name
  if (logoUrl !== undefined) updateData.logoUrl = logoUrl
  if (allowPersonalApiKeys !== undefined) updateData.allowPersonalApiKeys = allowPersonalApiKeys

  if (billedAccountUserId !== undefined) {
    if (previous.organizationId && previous.workspaceMode === 'organization') {
      throw new OrchestrationError(
        'validation',
        'Organization workspaces use organization billing and cannot change billed account.'
      )
    }
    if (previous.workspaceMode === 'personal') {
      throw new OrchestrationError(
        'validation',
        'Personal workspaces are always billed to their owner and cannot change billed account.'
      )
    }
    const candidatePermission = await getEffectiveWorkspacePermission(billedAccountUserId, previous)
    if (candidatePermission !== 'admin') {
      throw new OrchestrationError('validation', 'Billed account must be a workspace admin')
    }
  }

  updateData.updatedAt = new Date()

  const updated =
    billedAccountUserId === undefined
      ? await updateWorkspaceRow(db, workspaceId, updateData)
      : await db.transaction(async (tx) => {
          await changeWorkspaceStoragePayerInTx(tx, {
            workspaceId,
            organizationId: previous.organizationId,
            billedAccountUserId,
            expectedCurrentPayer: {
              organizationId: previous.organizationId,
              billedAccountUserId: previous.billedAccountUserId,
            },
          })
          return updateWorkspaceRow(tx, workspaceId, updateData)
        })

  return { previous, updated }
}

/**
 * Writes the patch only while the workspace is still active: an archival that
 * commits after the earlier reads leaves no row to update, which answers the
 * same not-found as a workspace that was already gone (and rolls back a
 * billed-account transfer).
 */
async function updateWorkspaceRow(
  executor: DbOrTx,
  workspaceId: string,
  updateData: Partial<WorkspaceRow>
): Promise<WorkspaceRow> {
  const [row] = await executor
    .update(workspace)
    .set(updateData)
    .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
    .returning()
  if (!row) throw new OrchestrationError('not_found', 'Workspace not found')
  return row
}
