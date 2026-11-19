import { db } from '@sim/db'
import { workflow, workflowBuildNotes, workspaceFiles } from '@sim/db/schema'
import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'

export type BuildNotesRow = typeof workflowBuildNotes.$inferSelect

function fileIdsOf(rows: readonly { notesFileId: string; baselineFileId: string | null }[]) {
  return rows.flatMap((row) =>
    row.baselineFileId ? [row.notesFileId, row.baselineFileId] : [row.notesFileId]
  )
}

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

/**
 * Records a baseline only if it is not older than the one recorded, so a rebase that read the
 * graph before a build committed cannot replace that build's baseline. False when it is older.
 * A new baseline also withdraws any recorded evaluation: it was reached against the previous one,
 * including a late verdict recorded after a build committed but before its baseline was saved.
 */
export async function setBuildNotesBaseline(
  notesId: string,
  baseline: { baselineFileId?: string; baselineWorkflowUpdatedAt: Date },
  executor: DbOrTx = db
): Promise<boolean> {
  const set = await executor
    .update(workflowBuildNotes)
    .set({
      ...baseline,
      evaluatedNotesHash: null,
      evaluatedOperationsHash: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(workflowBuildNotes.id, notesId),
        or(
          isNull(workflowBuildNotes.baselineWorkflowUpdatedAt),
          lte(workflowBuildNotes.baselineWorkflowUpdatedAt, baseline.baselineWorkflowUpdatedAt)
        )
      )
    )
    .returning({ id: workflowBuildNotes.id })
  return set.length === 1
}

/**
 * Records a passing evaluation only while the baseline it was evaluated against is still the
 * recorded one. A build or rebase that finished during the evaluation moved the baseline, so a
 * verdict reached on the older graph cannot revive an approval that build already spent.
 */
export async function recordBuildNotesEvaluation(
  notesId: string,
  evaluation: { evaluatedNotesHash: string; evaluatedOperationsHash: string },
  evaluatedAgainst: { baselineWorkflowUpdatedAt: Date | null }
): Promise<boolean> {
  const recorded = await db
    .update(workflowBuildNotes)
    .set({ ...evaluation, updatedAt: new Date() })
    .where(
      and(
        eq(workflowBuildNotes.id, notesId),
        isNull(workflowBuildNotes.deletedAt),
        evaluatedAgainst.baselineWorkflowUpdatedAt
          ? eq(
              workflowBuildNotes.baselineWorkflowUpdatedAt,
              evaluatedAgainst.baselineWorkflowUpdatedAt
            )
          : isNull(workflowBuildNotes.baselineWorkflowUpdatedAt)
      )
    )
    .returning({ id: workflowBuildNotes.id })
  return recorded.length === 1
}

/**
 * Holds the workflow row, shared, inside a build-notes file's insert transaction and refuses an
 * archived workflow. Archiving updates that row first, so an archive and a create serialize: the
 * create sees the archive and rolls back, or the archive sees the new notes and takes them down.
 */
export async function requireLiveWorkflowInTx(tx: DbOrTx, workflowId: string): Promise<void> {
  const [live] = await tx
    .select({ id: workflow.id })
    .from(workflow)
    .where(and(eq(workflow.id, workflowId), isNull(workflow.archivedAt)))
    .limit(1)
    .for('share')
  if (!live) throw new OrchestrationError('not_found', 'Workflow not found')
}

export type BuildNotesState = 'current' | 'changed'

/**
 * For each listed workflow with live notes: `changed` when it was saved after its baseline was
 * recorded, which may be a layout move only; `current` otherwise. A hint from the workflow's save
 * time, which an editor field edit may not move; a build compares the graph itself.
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
 * restore brings back exactly these rows. Called after the workflow rows are archived, and
 * archives the files before the notes rows: every path that locks more than one of these takes
 * them in that order (a build: workflow, then notes; a notes write: file, then notes), so none
 * can wait on another in a cycle.
 *
 * Workspace archive also runs inside the project membership script migration, against a schema
 * migrated only to that point, where this table does not exist yet and there is nothing to archive.
 */
export async function archiveBuildNotesForWorkflows(
  tx: DbTransaction,
  workflowIds: readonly string[],
  at: Date
): Promise<void> {
  if (workflowIds.length === 0) return
  const [table] = await tx.execute<{ present: boolean }>(
    sql`SELECT to_regclass('public.workflow_build_notes') IS NOT NULL AS present`
  )
  if (!table?.present) return
  const live = await tx
    .select({
      id: workflowBuildNotes.id,
      notesFileId: workflowBuildNotes.notesFileId,
      baselineFileId: workflowBuildNotes.baselineFileId,
    })
    .from(workflowBuildNotes)
    .where(
      and(
        inArray(workflowBuildNotes.workflowId, [...workflowIds]),
        isNull(workflowBuildNotes.deletedAt)
      )
    )
  if (live.length === 0) return
  await tx
    .update(workspaceFiles)
    .set({ deletedAt: at, updatedAt: at })
    .where(
      and(
        inArray(workspaceFiles.id, fileIdsOf(live)),
        eq(workspaceFiles.context, 'build_notes'),
        isNull(workspaceFiles.deletedAt)
      )
    )
  await tx
    .update(workflowBuildNotes)
    .set({ deletedAt: at, updatedAt: at })
    .where(
      and(
        inArray(
          workflowBuildNotes.id,
          live.map((row) => row.id)
        ),
        isNull(workflowBuildNotes.deletedAt)
      )
    )
}

/**
 * Brings back the notes and files an archive stamped `archivedAt`, for each workflow restored,
 * files before notes rows like the archive.
 */
export async function restoreBuildNotesForWorkflows(
  tx: Pick<typeof db, 'select' | 'update'>,
  workflowIds: readonly string[],
  archivedAt: Date,
  now: Date
): Promise<void> {
  if (workflowIds.length === 0) return
  const archived = await tx
    .select({
      id: workflowBuildNotes.id,
      notesFileId: workflowBuildNotes.notesFileId,
      baselineFileId: workflowBuildNotes.baselineFileId,
    })
    .from(workflowBuildNotes)
    .where(
      and(
        inArray(workflowBuildNotes.workflowId, [...workflowIds]),
        eq(workflowBuildNotes.deletedAt, archivedAt)
      )
    )
  if (archived.length === 0) return
  await tx
    .update(workspaceFiles)
    .set({ deletedAt: null, updatedAt: now })
    .where(
      and(
        inArray(workspaceFiles.id, fileIdsOf(archived)),
        eq(workspaceFiles.context, 'build_notes'),
        eq(workspaceFiles.deletedAt, archivedAt)
      )
    )
  await tx
    .update(workflowBuildNotes)
    .set({ deletedAt: null, updatedAt: now })
    .where(
      and(
        inArray(
          workflowBuildNotes.id,
          archived.map((row) => row.id)
        ),
        eq(workflowBuildNotes.deletedAt, archivedAt)
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

/**
 * Spends the evaluation a build was checked against, inside the build's transaction. The update
 * holds the notes row, so a notes write (which spends it too) either commits first and this finds
 * nothing to spend, or waits for the build. False when the evaluation is no longer the one checked.
 */
export async function spendBuildNotesEvaluation(
  tx: DbOrTx,
  notesId: string,
  evaluated: { notesHash: string; operationsHash: string }
): Promise<boolean> {
  const spent = await tx
    .update(workflowBuildNotes)
    .set({ evaluatedNotesHash: null, evaluatedOperationsHash: null, updatedAt: new Date() })
    .where(
      and(
        eq(workflowBuildNotes.id, notesId),
        isNull(workflowBuildNotes.deletedAt),
        eq(workflowBuildNotes.evaluatedNotesHash, evaluated.notesHash),
        eq(workflowBuildNotes.evaluatedOperationsHash, evaluated.operationsHash)
      )
    )
    .returning({ id: workflowBuildNotes.id })
  return spent.length === 1
}
