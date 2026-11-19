import { db } from '@sim/db'
import { workflow, workflowBuildNotes, workspaceFiles } from '@sim/db/schema'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'

export type BuildNotesRow = typeof workflowBuildNotes.$inferSelect

/** Live notes belong to a live row on a workflow that is not archived. */
const liveOwner = and(isNull(workflowBuildNotes.deletedAt), isNull(workflow.archivedAt))

export async function insertBuildNotesInTx(
  tx: DbTransaction,
  values: typeof workflowBuildNotes.$inferInsert
): Promise<BuildNotesRow> {
  const [row] = await tx.insert(workflowBuildNotes).values(values).returning()
  return row
}

export async function getLiveBuildNotesForWorkflow(
  workspaceId: string,
  workflowId: string,
  executor: DbOrTx = db
): Promise<BuildNotesRow | null> {
  const [row] = await executor
    .select({ notes: workflowBuildNotes })
    .from(workflowBuildNotes)
    .innerJoin(workflow, eq(workflow.id, workflowBuildNotes.workflowId))
    .where(
      and(
        eq(workflowBuildNotes.workspaceId, workspaceId),
        eq(workflowBuildNotes.workflowId, workflowId),
        liveOwner
      )
    )
    .limit(1)
  return row?.notes ?? null
}

/** The live notes owning a file, as either its notes or its baseline. */
export async function getLiveBuildNotesByFileId(
  fileId: string,
  executor: DbOrTx = db
): Promise<BuildNotesRow | null> {
  const [row] = await executor
    .select({ notes: workflowBuildNotes })
    .from(workflowBuildNotes)
    .innerJoin(workflow, eq(workflow.id, workflowBuildNotes.workflowId))
    .where(
      and(
        or(
          eq(workflowBuildNotes.notesFileId, fileId),
          eq(workflowBuildNotes.baselineFileId, fileId)
        ),
        liveOwner
      )
    )
    .limit(1)
  return row?.notes ?? null
}

export async function setBuildNotesBaseline(
  notesId: string,
  baseline: { baselineFileId?: string; baselineWorkflowUpdatedAt: Date },
  executor: DbOrTx = db
): Promise<void> {
  await executor
    .update(workflowBuildNotes)
    .set({ ...baseline, updatedAt: new Date() })
    .where(eq(workflowBuildNotes.id, notesId))
}

export async function recordBuildNotesEvaluation(
  notesId: string,
  evaluation: { evaluatedNotesHash: string; evaluatedOperationsHash: string }
): Promise<void> {
  await db
    .update(workflowBuildNotes)
    .set({ ...evaluation, updatedAt: new Date() })
    .where(eq(workflowBuildNotes.id, notesId))
}

export type BuildNotesState = 'current' | 'changed'

/**
 * For each listed workflow with live notes: `changed` when it was saved after its baseline was
 * recorded, which may be a layout move only; `current` otherwise.
 */
export async function readBuildNotesStates(
  workspaceId: string,
  workflowIds: readonly string[]
): Promise<Map<string, BuildNotesState>> {
  if (workflowIds.length === 0) return new Map()
  const rows = await db
    .select({
      workflowId: workflowBuildNotes.workflowId,
      baselineWorkflowUpdatedAt: workflowBuildNotes.baselineWorkflowUpdatedAt,
      workflowUpdatedAt: workflow.updatedAt,
    })
    .from(workflowBuildNotes)
    .innerJoin(workflow, eq(workflow.id, workflowBuildNotes.workflowId))
    .where(
      and(
        eq(workflowBuildNotes.workspaceId, workspaceId),
        inArray(workflowBuildNotes.workflowId, [...workflowIds]),
        liveOwner
      )
    )
  return new Map(
    rows.map((row) => [
      row.workflowId,
      row.baselineWorkflowUpdatedAt && row.workflowUpdatedAt <= row.baselineWorkflowUpdatedAt
        ? 'current'
        : 'changed',
    ])
  )
}

/**
 * Takes archived workflows' notes and both their files down with the archive's stamp, so a
 * restore brings back exactly these rows.
 */
export async function archiveBuildNotesForWorkflows(
  tx: DbTransaction,
  workflowIds: readonly string[],
  at: Date
): Promise<void> {
  if (workflowIds.length === 0) return
  const archived = await tx
    .update(workflowBuildNotes)
    .set({ deletedAt: at, updatedAt: at })
    .where(
      and(
        inArray(workflowBuildNotes.workflowId, [...workflowIds]),
        isNull(workflowBuildNotes.deletedAt)
      )
    )
    .returning({
      notesFileId: workflowBuildNotes.notesFileId,
      baselineFileId: workflowBuildNotes.baselineFileId,
    })
  const fileIds = archived.flatMap((row) => [row.notesFileId, row.baselineFileId ?? []].flat())
  if (fileIds.length === 0) return
  await tx
    .update(workspaceFiles)
    .set({ deletedAt: at, updatedAt: at })
    .where(
      and(
        inArray(workspaceFiles.id, fileIds),
        eq(workspaceFiles.context, 'build_notes'),
        isNull(workspaceFiles.deletedAt)
      )
    )
}

/** Brings back the notes and files an archive stamped `archivedAt`. */
export async function restoreBuildNotesForWorkflow(
  tx: DbTransaction,
  workflowId: string,
  archivedAt: Date,
  now: Date
): Promise<void> {
  const restored = await tx
    .update(workflowBuildNotes)
    .set({ deletedAt: null, updatedAt: now })
    .where(
      and(
        eq(workflowBuildNotes.workflowId, workflowId),
        eq(workflowBuildNotes.deletedAt, archivedAt)
      )
    )
    .returning({
      notesFileId: workflowBuildNotes.notesFileId,
      baselineFileId: workflowBuildNotes.baselineFileId,
    })
  const fileIds = restored.flatMap((row) => [row.notesFileId, row.baselineFileId ?? []].flat())
  if (fileIds.length === 0) return
  await tx
    .update(workspaceFiles)
    .set({ deletedAt: null, updatedAt: now })
    .where(
      and(
        inArray(workspaceFiles.id, fileIds),
        eq(workspaceFiles.context, 'build_notes'),
        eq(workspaceFiles.deletedAt, archivedAt)
      )
    )
}

/** Forgets the latest passing evaluation, so the next apply needs a fresh one. */
export async function clearBuildNotesEvaluation(
  notesId: string,
  executor: DbOrTx = db
): Promise<void> {
  await executor
    .update(workflowBuildNotes)
    .set({ evaluatedNotesHash: null, evaluatedOperationsHash: null, updatedAt: new Date() })
    .where(eq(workflowBuildNotes.id, notesId))
}
