import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
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
  clearBuildNotesEvaluation,
  getLiveBuildNotesForWorkflow,
} from '@/lib/build-notes/repository'
import { isCopilotPrincipal } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const logger = createLogger('BuildNotesGuard')

interface GuardedWrite {
  principal: Principal
  workflowId: string
  workspaceId: string
  workspaceOrganizationId: string | null
  /** What an operations apply writes; absent for a whole-graph replace. */
  batch?: BuildNotesBatch
}

/**
 * The checks Copilot's graph write passes when its workflow has build notes and the feature is
 * on: the notes passed evaluation as they are now, an operations batch is the one that evaluation
 * dry-ran, and nothing changed the graph outside the agent since the baseline. Returns the notes
 * so the write can move the baseline after it commits; null when there is nothing to check.
 *
 * A person's write is never checked: like an edit in the editor, it lands, and the agent
 * reconciles it from `build-notes changes` on its next build.
 *
 * Runs before the write, against the stored graph. The write's own stored-graph check under the
 * workflow lock then refuses any edit that lands between the two.
 */
export async function assertBuildNotesAllowWrite(
  write: GuardedWrite
): Promise<BuildNotesRow | null> {
  if (!isCopilotPrincipal(write.principal)) return null
  const notes = await getLiveBuildNotesForWorkflow(write.workspaceId, write.workflowId)
  if (!notes || !(await isBuildNotesEnabled(write.workspaceOrganizationId))) return null
  const notesPath = buildNotesPath(write.workflowId, 'notes')
  const text = await readBuildNotesFileText(write.workspaceId, notes.notesFileId)
  if (notes.evaluatedNotesHash !== notesHash(text)) {
    throw new OrchestrationError(
      'conflict',
      `${notesPath} has not passed evaluation as it is now. Run build-notes evaluate, then apply the operations block it passed.`
    )
  }
  if (write.batch && notes.evaluatedOperationsHash !== batchHash(write.batch)) {
    throw new OrchestrationError(
      'conflict',
      `This batch is not the operations block in ${notesPath} that build-notes evaluate passed. Apply that block, or update the notes and evaluate again.`
    )
  }
  if (notes.baselineFileId) {
    const [baselineText, current] = await Promise.all([
      readBaselineText(write.workspaceId, notes.baselineFileId),
      loadCurrentBaselineState(write.workflowId),
    ])
    if (diffFromBaseline(parseBaseline(baselineText), current.state).hasChanges) {
      throw new OrchestrationError(
        'conflict',
        `The workflow changed outside the agent since ${buildNotesPath(write.workflowId, 'baseline')} was recorded. Run build-notes changes, reconcile the notes, then build-notes rebase.`
      )
    }
  }
  return notes
}

/**
 * After a guarded write commits: the evaluation is spent, so the same batch cannot be applied
 * twice, and the baseline becomes the graph just written. The write already committed, so a
 * baseline that fails to save is logged rather than reported as a failed build; the next build
 * then sees the agent's own edit as a change to reconcile.
 */
export async function recordBuildNotesWrite(notes: BuildNotesRow, userId: string): Promise<void> {
  await clearBuildNotesEvaluation(notes.id)
  try {
    const current = await loadCurrentBaselineState(notes.workflowId)
    await writeBaseline(notes, current, { userId, source: 'copilot' })
  } catch (error) {
    logger.error('Build-notes baseline was not moved after a build', {
      workflowId: notes.workflowId,
      error: getErrorMessage(error),
    })
  }
}
