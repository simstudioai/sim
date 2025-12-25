import { useMemo } from 'react'
import { hasWorkflowChanged } from '@/lib/workflows/comparison'
import { useDebounce } from '@/hooks/use-debounce'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

interface UseChangeDetectionProps {
  workflowId: string | null
  deployedState: WorkflowState | null
  isLoadingDeployedState: boolean
}

/**
 * Detects meaningful changes between current workflow state and deployed state.
 * Performs comparison entirely on the client - no API calls needed.
 */
export function useChangeDetection({
  workflowId,
  deployedState,
  isLoadingDeployedState,
}: UseChangeDetectionProps) {
  const blocks = useWorkflowStore((state) => state.blocks)
  const edges = useWorkflowStore((state) => state.edges)
  const loops = useWorkflowStore((state) => state.loops)
  const parallels = useWorkflowStore((state) => state.parallels)
  const subBlockValues = useSubBlockStore((state) =>
    workflowId ? state.workflowValues[workflowId] : null
  )

  // Build current state with subblock values merged into blocks
  const currentState = useMemo((): WorkflowState | null => {
    if (!workflowId) return null

    const blocksWithSubBlocks: WorkflowState['blocks'] = {}
    for (const [blockId, block] of Object.entries(blocks)) {
      const blockSubValues = subBlockValues?.[blockId] || {}
      const subBlocks: Record<string, any> = {}

      // Merge subblock values into the block's subBlocks structure
      for (const [subId, value] of Object.entries(blockSubValues)) {
        subBlocks[subId] = { value }
      }

      // Also include existing subBlocks from the block itself
      if (block.subBlocks) {
        for (const [subId, subBlock] of Object.entries(block.subBlocks)) {
          if (!subBlocks[subId]) {
            subBlocks[subId] = subBlock
          } else {
            subBlocks[subId] = { ...subBlock, value: subBlocks[subId].value }
          }
        }
      }

      blocksWithSubBlocks[blockId] = {
        ...block,
        subBlocks,
      }
    }

    return {
      blocks: blocksWithSubBlocks,
      edges,
      loops,
      parallels,
    }
  }, [workflowId, blocks, edges, loops, parallels, subBlockValues])

  // Compute change detection with debouncing for performance
  const rawChangeDetected = useMemo(() => {
    if (!currentState || !deployedState || isLoadingDeployedState) {
      return false
    }
    return hasWorkflowChanged(currentState, deployedState)
  }, [currentState, deployedState, isLoadingDeployedState])

  // Debounce to avoid UI flicker during rapid edits
  const changeDetected = useDebounce(rawChangeDetected, 300)

  const setChangeDetected = () => {
    // No-op: change detection is now computed, not stateful
    // Kept for API compatibility
  }

  return { changeDetected, setChangeDetected }
}
