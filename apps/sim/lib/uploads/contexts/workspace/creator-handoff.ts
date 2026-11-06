import { workspaceFiles } from '@sim/db/schema'
import { asc, inArray, type SQL } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db/types'
import { snapshotWorkspaceFileSecretProvenanceInTx } from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import {
  isVersionHeadCurrent,
  loadWorkspaceFileVersionHeads,
  materializeWorkspaceFileVersionInTx,
} from '@/lib/uploads/contexts/workspace/file-version-store'

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
  const versioned = files.filter(
    (file) => file.context === 'workspace' || file.context === 'project'
  )
  const heads = await loadWorkspaceFileVersionHeads(
    versioned.map((file) => file.id),
    tx
  )
  for (const file of versioned) {
    const head = heads.get(file.id)
    if (isVersionHeadCurrent(head, file)) continue
    const provenance =
      file.projectId && file.secretProvenanceVersion === null
        ? { status: 'unknown' as const, entries: [] }
        : await snapshotWorkspaceFileSecretProvenanceInTx(
            tx,
            file.id,
            file.contentUpdatedAt,
            file.secretProvenanceVersion
          )
    await materializeWorkspaceFileVersionInTx(tx, file, head, provenance, new Date())
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
