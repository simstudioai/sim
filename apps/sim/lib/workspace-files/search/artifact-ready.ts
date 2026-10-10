import {
  fileSearchDispatchQueue,
  workspaceFileSearchBuild,
  workspaceFileSearchRevision,
} from '@sim/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db/types'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import { lockFileSearchInputs } from '@/lib/workspace-files/search/index-state'
import {
  fileSearchOwnerCondition,
  fileSearchOwnerFields,
  resolveFileSearchOwner,
} from '@/lib/workspace-files/search/scope'
import type { FileSearchDependencyIdentity } from '@/lib/workspace-files/search/source'

/** A renderer's private receipt; surfaces cannot supply it through a file contract. */
interface FileSearchArtifactCompletion {
  owner: EditableFileOwner
  file: { fileId: string; key: string; contentUpdatedAt: Date }
  dependencies: readonly FileSearchDependencyIdentity[]
  artifactKey: string
}

/** Requeues only current stored inputs and fences workers that read before the artifact existed. */
export async function markFileSearchArtifactReadyInTx(
  tx: DbTransaction,
  input: FileSearchArtifactCompletion
): Promise<boolean> {
  const owner = resolveFileSearchOwner(input)
  const prefix =
    owner.entityType === 'workspace'
      ? `copilot-doc-compiled/${owner.entityId}/`
      : `project/${owner.entityId}/compiled/`
  if (
    !input.artifactKey.startsWith(prefix) ||
    !/^[a-f0-9]{64}\.(docx|pptx|pdf|xlsx)$/.test(input.artifactKey.slice(prefix.length))
  )
    throw new Error('Artifact receipt does not belong to this file owner')
  const revision = {
    owner,
    fileId: input.file.fileId,
    sourceContentUpdatedAt: input.file.contentUpdatedAt,
  }
  if (!(await lockFileSearchInputs(tx, revision, input.dependencies, input.file.key))) return false
  const predicate = and(
    eq(workspaceFileSearchRevision.fileId, revision.fileId),
    fileSearchOwnerCondition(workspaceFileSearchRevision, owner),
    eq(workspaceFileSearchRevision.sourceContentUpdatedAt, revision.sourceContentUpdatedAt)
  )
  const [state] = await tx.select().from(workspaceFileSearchRevision).where(predicate).limit(1)
  if (state?.buildId) {
    const [build] = await tx
      .select({ artifactKey: workspaceFileSearchBuild.artifactKey })
      .from(workspaceFileSearchBuild)
      .where(eq(workspaceFileSearchBuild.id, state.buildId))
      .for('update')
    if (state.status === 'ready' && build?.artifactKey === input.artifactKey) return false
    await tx
      .update(workspaceFileSearchBuild)
      .set({ expiresAt: sql`clock_timestamp()` })
      .where(eq(workspaceFileSearchBuild.id, state.buildId))
  }
  const now = new Date()
  await tx
    .insert(workspaceFileSearchRevision)
    .values({
      ...fileSearchOwnerFields(owner),
      fileId: revision.fileId,
      sourceContentUpdatedAt: revision.sourceContentUpdatedAt,
    })
    .onConflictDoUpdate({
      target: workspaceFileSearchRevision.fileId,
      set: {
        status: 'pending',
        buildId: null,
        dispatchedAt: null,
        handoffExpiresAt: null,
        failureReason: null,
        lineCount: 0,
        indexedBytes: 0,
        chunkCount: 0,
        updatedAt: now,
      },
      setWhere: predicate,
    })
  await tx
    .insert(fileSearchDispatchQueue)
    .values({ ...owner, enqueuedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [fileSearchDispatchQueue.entityType, fileSearchDispatchQueue.entityId],
      set: { updatedAt: now },
    })
  return true
}
