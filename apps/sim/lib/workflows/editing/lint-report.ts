import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import {
  collectDanglingBlockOutputReferences,
  collectWorkflowFieldIssues,
  hasWorkflowEntryBlock,
  lintEditedWorkflowState,
  type WorkflowLintReport,
  type WorkflowLintUnresolvedReference,
} from '@/lib/workflows/editing/lint'
import {
  collectUnresolvedAgentToolReferences,
  collectUnresolvedReferences,
  UNRESOLVABLE_AT_LINT_NOTE,
} from '@/lib/workflows/editing/validation'

const logger = createLogger('WorkflowLintReport')

/**
 * Why a report carries no reference findings for a non-human caller.
 *
 * Credential, tool, and skill references resolve against a specific human's
 * grants. A workspace API key has no human subject, and the identity that would
 * stand in for one is the workspace's billing owner — a different person, whose
 * credentials this caller cannot use. Resolving against them would report a
 * reference as resolvable when the workflow cannot in fact reach it, and would
 * disclose which credentials that human holds. So the reference pass is skipped
 * and said to be skipped, rather than answered against the wrong identity.
 */
export const REFERENCES_UNCHECKED_NOTE =
  'Credential, tool, and skill references were not checked because this caller does not act as a human user. Structural and field findings are complete.'

/**
 * A graph with nothing in it lints perfectly clean, which is the wrong signal
 * for a `PUT /state` whose whole effect would be to erase the workflow.
 */
export const EMPTY_GRAPH_NOTE =
  'The graph has no blocks — replacing with this empties the workflow.'

/**
 * Every block has an incoming edge, or none of them is a trigger: the graph
 * may be fully wired and still have nowhere to begin. Not an `orphanBlocks`
 * finding — a cycle of non-trigger blocks has no orphan and no entry.
 */
export const NO_ENTRY_BLOCK_NOTE = 'No entry block: nothing can start this workflow.'

export interface WorkflowLintScope {
  workflowId: string
  workspaceId: string
  /**
   * The human whose grants references resolve against, or `null` when the
   * caller is not acting as one. Never a billing-owner or creator stand-in.
   */
  subjectUserId: string | null
}

/**
 * Builds the advisory report published by both graph writes.
 *
 * Shared so `PUT /state` and `POST /operations` cannot drift: an agent that
 * authors a whole graph and one that edits it incrementally need the same
 * findings, and a finding added for one caller must reach the other.
 *
 * Findings never block a write. Reference resolution is best-effort — its
 * collectors read the database, and a failure there must not fail a write that
 * has already been validated — so a collector that throws is logged and its
 * findings omitted rather than propagated.
 */
export async function buildWorkflowLintReport(
  graph: Pick<WorkflowState, 'blocks' | 'edges'>,
  scope: WorkflowLintScope
): Promise<WorkflowLintReport> {
  const unresolvedReferences: WorkflowLintUnresolvedReference[] = []

  // Pure graph check, so it runs for every caller: a dangling block-output
  // reference passes literal text through at run time on the surfaces that
  // do not fail loudly (API bodies, agent prompts).
  unresolvedReferences.push(...collectDanglingBlockOutputReferences(graph))

  if (scope.subjectUserId) {
    for (const collect of [collectUnresolvedReferences, collectUnresolvedAgentToolReferences]) {
      try {
        /**
         * Reported only through `lint`. These collectors are read-only, so the
         * values they flag stay persisted — pushing them into
         * `inputValidationErrors` as well would double-report them, and falsely,
         * since that field means "dropped rather than persisted".
         */
        const references = await collect(graph, {
          userId: scope.subjectUserId,
          workspaceId: scope.workspaceId,
        })
        unresolvedReferences.push(...references)
      } catch (error) {
        logger.warn('Reference resolution lint failed', {
          workflowId: scope.workflowId,
          error: getErrorMessage(error),
        })
      }
    }
  }

  const graphLint = lintEditedWorkflowState(graph)

  const notes: string[] = []
  if (!scope.subjectUserId) notes.push(REFERENCES_UNCHECKED_NOTE)
  if (unresolvedReferences.length > 0) notes.push(UNRESOLVABLE_AT_LINT_NOTE)
  if (Object.keys(graph.blocks ?? {}).length === 0) {
    notes.push(EMPTY_GRAPH_NOTE)
  } else if (graphLint.sources.length === 0 || !hasWorkflowEntryBlock(graph.blocks)) {
    notes.push(NO_ENTRY_BLOCK_NOTE)
  }

  /**
   * `fieldIssues`, `unresolvedReferences`, and `notes` are assigned after the
   * graph-lint spread and that is safe: {@link lintEditedWorkflowState} returns
   * `WorkflowLintResult`, which declares none of them, so the assignment can
   * never discard a finding the linter made.
   */
  return {
    ...graphLint,
    fieldIssues: collectWorkflowFieldIssues(graph.blocks),
    unresolvedReferences,
    notes,
  }
}
