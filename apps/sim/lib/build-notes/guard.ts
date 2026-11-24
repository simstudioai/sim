import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  type BaselineGraph,
  type BaselineSnapshot,
  diffFromBaseline,
  loadCurrentBaselineState,
  parseBaseline,
} from '@/lib/build-notes/baseline'
import { isBuildNotesEnabled } from '@/lib/build-notes/feature-flag'
import { readBaselineText, readBuildNotesFileText, writeBaseline } from '@/lib/build-notes/files'
import { type BuildNotesBatch, batchHash, notesHash } from '@/lib/build-notes/notes'
import { buildNotesPath } from '@/lib/build-notes/paths'
import {
  type BuildNotesRow,
  getLiveBuildNotesForWorkflow,
  spendBuildNotesEvaluation,
} from '@/lib/build-notes/repository'
import { isCopilotPrincipal } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('BuildNotesGuard')

interface GuardedWrite {
  principal: Principal
  workflowId: string
  workspaceId: string
  workspaceOrganizationId: string | null
  /** What an operations apply writes; absent for a whole-graph replace. */
  batch?: BuildNotesBatch
}

/** What a guarded write was checked against, held again under the workflow lock. */
export interface BuildNotesWriteCheck {
  notes: BuildNotesRow
  evaluated: { notesHash: string; operationsHash: string }
  baseline: BaselineGraph
}

function changedOutside(workflowId: string): OrchestrationError {
  return new OrchestrationError(
    'conflict',
    `The workflow changed outside the agent since ${buildNotesPath(workflowId, 'baseline')} was recorded. Run build-notes changes, reconcile the notes, then build-notes rebase.`
  )
}

/**
 * The checks Copilot's graph write passes when its workflow has build notes and the feature is
 * on: it is an operations apply of the batch evaluation passed, from notes unchanged since, on a
 * graph unchanged since the baseline. A whole-graph replace is refused outright: it cannot be
 * tied to an evaluated batch. Null when there is nothing to check.
 *
 * A person's write is never checked: like an edit in the editor, it lands, and the agent
 * reconciles it from `build-notes changes` on its next build.
 *
 * This runs before the build so a stale build fails fast with an actionable message; the write
 * then holds the same check under the workflow lock with {@link holdBuildNotesForWrite}.
 */
export async function assertBuildNotesAllowWrite(
  write: GuardedWrite
): Promise<BuildNotesWriteCheck | null> {
  if (!isCopilotPrincipal(write.principal)) return null
  const notes = await getLiveBuildNotesForWorkflow(write.workspaceId, write.workflowId)
  if (!notes || !(await isBuildNotesEnabled(write.workspaceOrganizationId))) return null
  const notesPath = buildNotesPath(write.workflowId, 'notes')
  if (!write.batch) {
    throw new OrchestrationError(
      'conflict',
      `This workflow has build notes, so a whole-graph replace is refused. Put the change in the operations block of ${notesPath}, run build-notes evaluate, then build-notes apply.`
    )
  }
  if (!notes.baselineFileId) {
    throw new OrchestrationError(
      'conflict',
      'These build notes have no baseline yet. Run build-notes rebase to record the current graph, then evaluate again.'
    )
  }
  const text = await readBuildNotesFileText(write.workspaceId, notes.notesFileId)
  const evaluated = { notesHash: notesHash(text), operationsHash: batchHash(write.batch) }
  if (notes.evaluatedNotesHash !== evaluated.notesHash) {
    throw new OrchestrationError(
      'conflict',
      `${notesPath} has not passed evaluation as it is now. Run build-notes evaluate, then apply the operations block it passed.`
    )
  }
  if (notes.evaluatedOperationsHash !== evaluated.operationsHash) {
    throw new OrchestrationError(
      'conflict',
      `This batch is not the operations block in ${notesPath} that build-notes evaluate passed. Apply that block, or update the notes and evaluate again.`
    )
  }
  const [baselineText, current] = await Promise.all([
    readBaselineText(write.workspaceId, notes.baselineFileId),
    loadCurrentBaselineState(write.workflowId),
  ])
  const baseline = parseBaseline(baselineText)
  if (diffFromBaseline(baseline, current).hasChanges) throw changedOutside(write.workflowId)
  return { notes, evaluated, baseline }
}

/**
 * Holds a checked write under the workflow lock, inside the write's own transaction: spends the
 * evaluation it was checked against (refusing when a notes write or another build spent it
 * first) and confirms the stored graph still matches the baseline, so an edit that landed after
 * the first check is reconciled rather than built over.
 */
export async function holdBuildNotesForWrite(
  check: BuildNotesWriteCheck,
  tx: DbOrTx
): Promise<void> {
  if (!(await spendBuildNotesEvaluation(tx, check.notes.id, check.evaluated))) {
    throw new OrchestrationError(
      'conflict',
      `${buildNotesPath(check.notes.workflowId, 'notes')} changed or was built from while this build was being prepared. Run build-notes evaluate again.`
    )
  }
  const current = await loadCurrentBaselineState(check.notes.workflowId, tx)
  if (diffFromBaseline(check.baseline, current).hasChanges) {
    throw changedOutside(check.notes.workflowId)
  }
}

/**
 * After a guarded write commits: the baseline becomes the graph that write committed. The build
 * already committed, so a baseline that fails to save is logged rather than reported as a failed
 * build; the next build then sees the agent's own edit as a change to reconcile.
 */
export async function recordBuildNotesWrite(
  check: BuildNotesWriteCheck,
  committed: BaselineSnapshot | undefined,
  userId: string
): Promise<void> {
  if (!committed) return
  try {
    await writeBaseline(check.notes, committed, { userId, source: 'copilot' })
  } catch (error) {
    logger.error('Build-notes baseline was not moved after a build', {
      workflowId: check.notes.workflowId,
      error: getErrorMessage(error),
    })
  }
}
