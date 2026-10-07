import { project } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import {
  type ProjectStorageBillingContext,
  resolveProjectStorageBillingContext,
  resolveStorageBillingContext,
  type StorageBillingContext,
} from '@/lib/billing/storage/context'
import { prepareFileStorageMutationInTx } from '@/lib/billing/storage/tracking'
import type { DbTransaction } from '@/lib/db/types'
import { lockProject, lockWorkspaceProject } from '@/lib/projects/membership'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'

interface PreparedFileAccounting<Billing = StorageBillingContext | ProjectStorageBillingContext> {
  billing: Billing
  mutation: { applyDelta(deltaBytes: number): Promise<number> }
}

export function prepareFileAccountingInTx(
  tx: DbTransaction,
  owner: { entityType: 'workspace'; entityId: string }
): Promise<PreparedFileAccounting<StorageBillingContext>>
export function prepareFileAccountingInTx(
  tx: DbTransaction,
  owner: { entityType: 'project'; entityId: string }
): Promise<PreparedFileAccounting<ProjectStorageBillingContext>>
export function prepareFileAccountingInTx(
  tx: DbTransaction,
  owner: EditableFileOwner
): Promise<PreparedFileAccounting>
/**
 * Prepares retained-head accounting in the caller's transaction, after authorization and before
 * directory, file, history or cleanup locks. Locks lifecycle, owner row, then payer; multi-owner
 * callers must acquire all lifecycle locks first. Resolve from the canonical owner, never actor
 * or creator. Apply one signed delta at finalization and notify only after the caller commits.
 */
export async function prepareFileAccountingInTx(
  tx: DbTransaction,
  owner: EditableFileOwner
): Promise<PreparedFileAccounting> {
  let billing: StorageBillingContext | ProjectStorageBillingContext
  if (owner.entityType === 'workspace') {
    await lockWorkspaceProject(tx, owner.entityId)
    billing = await resolveStorageBillingContext(owner.entityId, tx)
  } else {
    await lockProject(tx, owner.entityId)
    const [canonical] = await tx
      .select({ ownerId: project.ownerId, organizationId: project.organizationId })
      .from(project)
      .where(eq(project.id, owner.entityId))
      .limit(1)
    if (!canonical) throw new Error(`Project ${owner.entityId} not found for storage accounting`)
    billing = await resolveProjectStorageBillingContext(
      { projectId: owner.entityId, ...canonical },
      tx
    )
  }
  return { billing, mutation: await prepareFileStorageMutationInTx(tx, billing) }
}
