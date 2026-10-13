import { workspaceFiles } from '@sim/db/schema'
import { asc, inArray, type SQL } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db/types'
import { snapshotWorkspaceFileSecretProvenanceInTx } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  isVersionHeadCurrent,
  loadWorkspaceFileVersionHead,
  materializeWorkspaceFileVersionInTx,
} from '@/lib/uploads/contexts/workspace/workspace-file-versions'

/** Freezes implicit history under the writer lock before replacing a shared file's live creator. */
export async function handoffFileCreatorsInTx(
  tx: DbTransaction,
  condition: SQL | undefined,
  successorId: string
) {
  if (!condition) throw new Error('File creator handoff requires a scope')
  const files = await tx
    .select()
    .from(workspaceFiles)
    .where(condition)
    .orderBy(asc(workspaceFiles.id))
    .for('update')
  for (const file of files) {
    if (file.context !== 'workspace' || !file.workspaceId) continue
    const head = await loadWorkspaceFileVersionHead(file.id, tx)
    if (isVersionHeadCurrent(head, file)) continue
    const provenance = await snapshotWorkspaceFileSecretProvenanceInTx(
      tx,
      file.id,
      file.contentUpdatedAt,
      file.secretProvenanceVersion
    )
    await materializeWorkspaceFileVersionInTx(
      tx,
      { ...file, workspaceId: file.workspaceId },
      head,
      provenance,
      new Date()
    )
  }
  if (!files.length) return
  await tx
    .update(workspaceFiles)
    .set({ userId: successorId, updatedAt: new Date() })
    .where(
      inArray(
        workspaceFiles.id,
        files.map((file) => file.id)
      )
    )
}
