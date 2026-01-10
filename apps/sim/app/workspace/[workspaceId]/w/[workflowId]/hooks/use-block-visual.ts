import { useCallback, useMemo } from 'react'
import { useBlockState } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/hooks'
import type { WorkflowBlockProps } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/types'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-current-workflow'
import { getBlockRingStyles } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/block-ring-utils'
import { useExecutionStore } from '@/stores/execution'
import { usePanelEditorStore } from '@/stores/panel'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

/**
 * Props for the useBlockVisual hook.
 */
interface UseBlockVisualProps {
  /** The unique identifier of the block */
  blockId: string
  /** Block data including type, config, and preview state */
  data: WorkflowBlockProps
  /** Whether the block is pending execution */
  isPending?: boolean
}

/**
 * Provides visual state and interaction handlers for workflow blocks.
 * Computes ring styling based on execution, diff, deletion, and run path states.
 * In preview mode, uses isPreviewSelected for selection highlighting.
 *
 * @param props - The hook properties
 * @returns Visual state, click handler, and ring styling for the block
 */
export function useBlockVisual({ blockId, data, isPending = false }: UseBlockVisualProps) {
  const isPreview = data.isPreview ?? false
  const isPreviewSelected = data.isPreviewSelected ?? false

  const currentWorkflow = useCurrentWorkflow()
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  const {
    isEnabled,
    isActive: blockIsActive,
    diffStatus,
    isDeletedBlock,
  } = useBlockState(blockId, currentWorkflow, data)

  // In preview mode, use isPreviewSelected for selection state
  const isActive = isPreview ? isPreviewSelected : blockIsActive

  const lastRunPath = useExecutionStore((state) => state.lastRunPath)
  const runPathStatus = isPreview ? undefined : lastRunPath.get(blockId)

  const setCurrentBlockId = usePanelEditorStore((state) => state.setCurrentBlockId)

  const handleClick = useCallback(() => {
    if (!isPreview) {
      setCurrentBlockId(blockId)
    }
  }, [blockId, setCurrentBlockId, isPreview])

  const { hasRing, ringClassName: ringStyles } = useMemo(
    () =>
      getBlockRingStyles({
        isActive,
        isPending: isPreview ? false : isPending,
        isDeletedBlock: isPreview ? false : isDeletedBlock,
        diffStatus: isPreview ? undefined : diffStatus,
        runPathStatus,
        isPreviewSelection: isPreview && isPreviewSelected,
      }),
    [isActive, isPending, isDeletedBlock, diffStatus, runPathStatus, isPreview, isPreviewSelected]
  )

  return {
    currentWorkflow,
    activeWorkflowId,
    isEnabled,
    handleClick,
    hasRing,
    ringStyles,
    runPathStatus,
  }
}
