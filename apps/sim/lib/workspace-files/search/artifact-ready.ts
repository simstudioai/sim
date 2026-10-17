import { db } from '@sim/db'
import {
  fileSearchDispatchQueue,
  workspaceFileSearchBuild,
  workspaceFileSearchRevision,
} from '@sim/db/schema'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db/types'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import { FILE_SEARCH_ARTIFACT_READY_LOCK_TIMEOUT_MS } from '@/lib/workspace-files/search/constants'
import { lockFileSearchInputs } from '@/lib/workspace-files/search/index-state'
import { lockFileSearchOwners } from '@/lib/workspace-files/search/owner-policy'
import {
  fileSearchOwnerCondition,
  fileSearchOwnerFields,
  resolveFileSearchOwner,
} from '@/lib/workspace-files/search/scope'
import type { FileSearchDependencyIdentity } from '@/lib/workspace-files/search/source'
import { configureFileSearchTransaction } from '@/lib/workspace-files/search/transaction'

/** A renderer's private receipt; surfaces cannot supply it through a file contract. */
export interface FileSearchArtifactCompletion {
  owner: EditableFileOwner
  file: { fileId: string; key: string; contentUpdatedAt: Date }
  dependencies: readonly FileSearchDependencyIdentity[]
  artifactKey: string
}

/** Pure check that the artifact key was minted for this file owner; throws otherwise. */
function assertFileSearchArtifactReceipt(input: FileSearchArtifactCompletion) {
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
  return owner
}

function artifactRevisionCondition(input: FileSearchArtifactCompletion, owner: EditableFileOwner) {
  return and(
    eq(workspaceFileSearchRevision.fileId, input.file.fileId),
    fileSearchOwnerCondition(workspaceFileSearchRevision, owner),
    eq(workspaceFileSearchRevision.sourceContentUpdatedAt, input.file.contentUpdatedAt)
  )
}

/**
 * Lock-free form of {@link markFileSearchArtifactReadyInTx}'s no-op test: the file's current
 * revision is already built from this artifact, published (ready or skipped) or still under a live
 * build lease.
 */
async function isFileSearchArtifactCurrent(
  input: FileSearchArtifactCompletion,
  owner: EditableFileOwner
): Promise<boolean> {
  const [current] = await db
    .select({ fileId: workspaceFileSearchRevision.fileId })
    .from(workspaceFileSearchRevision)
    .innerJoin(
      workspaceFileSearchBuild,
      eq(workspaceFileSearchBuild.id, workspaceFileSearchRevision.buildId)
    )
    .where(
      and(
        artifactRevisionCondition(input, owner),
        eq(workspaceFileSearchBuild.artifactKey, input.artifactKey),
        or(
          inArray(workspaceFileSearchRevision.status, ['ready', 'skipped']),
          and(
            eq(workspaceFileSearchRevision.status, 'pending'),
            sql`${workspaceFileSearchBuild.expiresAt} > clock_timestamp()`
          )
        )
      )
    )
    .limit(1)
  return current !== undefined
}

/**
 * Requeues search for a freshly rendered artifact unless its revision already uses it. The common
 * already-current case takes no locks; the locked requeue, owner lock included, is bounded by a
 * short lock timeout so a contended owner fails fast instead of stalling the read.
 */
export async function requeueFileSearchForRenderedArtifact(
  input: FileSearchArtifactCompletion
): Promise<void> {
  const owner = assertFileSearchArtifactReceipt(input)
  if (await isFileSearchArtifactCurrent(input, owner)) return
  await db.transaction(async (tx) => {
    await configureFileSearchTransaction(tx, {
      lockTimeout: FILE_SEARCH_ARTIFACT_READY_LOCK_TIMEOUT_MS,
    })
    // Held here under the short bound; the reentrant owner lock in the mark then returns at once.
    await lockFileSearchOwners(tx, [owner], {
      lockTimeoutMs: FILE_SEARCH_ARTIFACT_READY_LOCK_TIMEOUT_MS,
    })
    await markFileSearchArtifactReadyInTx(tx, input)
  })
}

/** Requeues only current stored inputs and fences workers that read before the artifact existed. */
export async function markFileSearchArtifactReadyInTx(
  tx: DbTransaction,
  input: FileSearchArtifactCompletion
): Promise<boolean> {
  const owner = assertFileSearchArtifactReceipt(input)
  const revision = {
    owner,
    fileId: input.file.fileId,
    sourceContentUpdatedAt: input.file.contentUpdatedAt,
  }
  if (!(await lockFileSearchInputs(tx, revision, input.dependencies, input.file.key))) return false
  const predicate = artifactRevisionCondition(input, owner)
  const [state] = await tx.select().from(workspaceFileSearchRevision).where(predicate).limit(1)
  if (state?.buildId) {
    const [build] = await tx
      .select({
        artifactKey: workspaceFileSearchBuild.artifactKey,
        live: sql<boolean>`${workspaceFileSearchBuild.expiresAt} > clock_timestamp()`,
      })
      .from(workspaceFileSearchBuild)
      .where(eq(workspaceFileSearchBuild.id, state.buildId))
      .for('update')
    if (
      build?.artifactKey === input.artifactKey &&
      (state.status === 'ready' ||
        state.status === 'skipped' ||
        (state.status === 'pending' && build.live))
    )
      return false
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
