import {
  WORKFLOW_SOURCE_HANDLE_ID,
  type WorkflowCardSide,
  type WorkflowConnectionSide,
} from '@sim/workflow-types/workflow'
import { Position } from '@xyflow/react'

export const CURSOR_SOURCE_HANDLE_ID = 'source-cursor'
const CURSOR_BRANCH_SOURCE_HANDLE_PREFIX = `${CURSOR_SOURCE_HANDLE_ID}-branch-`

/** Returns the temporary React Flow handle ID under the cursor swell. */
export function getCursorSourceHandleId(side: WorkflowConnectionSide): string {
  return `${CURSOR_SOURCE_HANDLE_ID}-${side}`
}

/** Keeps a branch output distinct while its temporary handle follows the cursor swell. */
export function getCursorBranchSourceHandleId(branchHandleId: string): string {
  return `${CURSOR_BRANCH_SOURCE_HANDLE_PREFIX}${branchHandleId}`
}

/** Uses the physical swell edge for the temporary preview's exit direction. */
export function getCursorSourceHandlePosition(side: WorkflowCardSide): Position {
  if (side === 'top') return Position.Top
  if (side === 'bottom') return Position.Bottom
  if (side === 'left') return Position.Left
  return Position.Right
}

/**
 * Converts a temporary cursor handle into its persistent handle id.
 *
 * The swell lets a drag START anywhere on the card's perimeter, but the
 * connection it creates is the block's one output, so it always resolves to
 * that block's canonical source id. Which perimeter edge the gesture began on
 * is presentation only and is deliberately not encoded in the persisted id —
 * a second id for the same port would defeat edge de-duplication and would not
 * be understood by the executor, the copilot edit pipeline, or the diff engine.
 * Loop and parallel containers keep their semantic end handles.
 */
export function normalizeCursorSourceHandleId(
  handleId: string | null | undefined,
  blockType?: string
): string | null | undefined {
  if (handleId?.startsWith(CURSOR_BRANCH_SOURCE_HANDLE_PREFIX)) {
    return handleId.slice(CURSOR_BRANCH_SOURCE_HANDLE_PREFIX.length)
  }

  const prefix = `${CURSOR_SOURCE_HANDLE_ID}-`
  if (!handleId?.startsWith(prefix)) return handleId

  if (blockType === 'loop') return 'loop-end-source'
  if (blockType === 'parallel') return 'parallel-end-source'

  return WORKFLOW_SOURCE_HANDLE_ID
}
