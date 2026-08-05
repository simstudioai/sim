import {
  getPositionedSourceHandleId,
  type PositionedSourceHandleSide,
  type WorkflowCardSide,
} from '@sim/workflow-types/workflow'
import { Position } from 'reactflow'

export const CURSOR_SOURCE_HANDLE_ID = 'source-cursor'
const CURSOR_BRANCH_SOURCE_HANDLE_PREFIX = `${CURSOR_SOURCE_HANDLE_ID}-branch-`

/** Returns the temporary React Flow handle ID under the cursor swell. */
export function getCursorSourceHandleId(side: PositionedSourceHandleSide): string {
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
 * Converts a temporary cursor handle into its persistent anchor.
 *
 * Outputs always leave from the right. The swell lets a drag START on any
 * edge — including the left, which is the input side — but the connection it
 * creates is an output, so it anchors right regardless of where the gesture
 * began. Loop and parallel containers retain their semantic end handles;
 * regular cards use the canonical positioned right anchor.
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

  return getPositionedSourceHandleId('right')
}
