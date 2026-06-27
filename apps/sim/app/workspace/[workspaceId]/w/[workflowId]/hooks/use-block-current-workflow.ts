import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { CurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-current-workflow'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { BlockState } from '@/stores/workflows/workflow/types'

/**
 * Per-block, narrowly-subscribed variant of {@link useCurrentWorkflow}.
 *
 * `useCurrentWorkflow` subscribes (via `useShallow`) to the entire
 * `{ blocks, edges, loops, parallels, lastSaved }` slice, so any structural
 * edit that replaces the `blocks` reference (rename, lock/enable toggle,
 * dimension settle, add/remove, paste) re-renders every mounted block at once.
 *
 * This hook returns the same {@link CurrentWorkflow} shape but subscribes only
 * to the fields a single block actually reads: its own block object and the
 * diff-mode flags. The `blocks` map it exposes contains only this block — every
 * consumer (`useBlockState`, `useBlockProperties`, `workflow-block.tsx`) only
 * ever indexes the map at `blockId`, so the narrowed map is behaviorally
 * identical while staying reference-stable across edits to other blocks.
 *
 * @param blockId - The block whose view of the workflow is needed
 * @returns A {@link CurrentWorkflow} scoped to the given block
 */
export function useBlockCurrentWorkflow(blockId: string): CurrentWorkflow {
  const normalBlock = useWorkflowStore((state) => state.blocks[blockId])

  const { isShowingDiff, isDiffReady, hasActiveDiff } = useWorkflowDiffStore(
    useShallow((state) => ({
      isShowingDiff: state.isShowingDiff,
      isDiffReady: state.isDiffReady,
      hasActiveDiff: state.hasActiveDiff,
    }))
  )

  const hasBaseline = useWorkflowDiffStore((state) => Boolean(state.baselineWorkflow))
  const baselineBlock = useWorkflowDiffStore((state) => state.baselineWorkflow?.blocks?.[blockId])

  return useMemo((): CurrentWorkflow => {
    const isSnapshotView = hasBaseline && hasActiveDiff && isDiffReady && !isShowingDiff

    const block = isSnapshotView ? baselineBlock : normalBlock
    const blocks: Record<string, BlockState> = block ? { [blockId]: block } : {}

    return {
      blocks,
      edges: [],
      loops: {},
      parallels: {},
      lastSaved: undefined,

      isDiffMode: hasActiveDiff && isShowingDiff,
      isNormalMode: !hasActiveDiff || (!isShowingDiff && !isSnapshotView),
      isSnapshotView,

      workflowState: { blocks, edges: [], loops: {}, parallels: {} },

      getBlockById: (id: string) => (id === blockId ? block : undefined),
      getBlockCount: () => (block ? 1 : 0),
      getEdgeCount: () => 0,
      hasBlocks: () => Boolean(block),
      hasEdges: () => false,
    }
  }, [blockId, normalBlock, baselineBlock, hasBaseline, isShowingDiff, isDiffReady, hasActiveDiff])
}
