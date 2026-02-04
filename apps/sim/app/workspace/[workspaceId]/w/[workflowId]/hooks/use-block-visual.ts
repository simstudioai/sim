import { useCallback, useMemo } from 'react'
import { useBlockState } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/hooks'
import type { WorkflowBlockProps } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/types'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-current-workflow'
import { getBlockRingStyles } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/block-ring-utils'
import { useExecutionStore } from '@/stores/execution'
import { usePanelEditorStore, usePanelStore } from '@/stores/panel'
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
  /** Whether the block is selected (via shift-click or selection box) */
  isSelected?: boolean
}

/**
 * Provides visual state and interaction handlers for workflow blocks.
 * Computes ring styling based on editor open state, execution, diff, deletion, and run path states.
 * Ring is shown only when the editor panel is open for this block, not during selection/dragging.
 * In preview mode, uses isPreviewSelected for selection highlighting.
 *
 * @param props - The hook properties
 * @returns Visual state, click handler, and ring styling for the block
 */
export function useBlockVisual({
  blockId,
  data,
  isPending = false,
  isSelected = false,
}: UseBlockVisualProps) {
  const isPreview = data.isPreview ?? false
  const isPreviewSelected = data.isPreviewSelected ?? false

  const currentWorkflow = useCurrentWorkflow()
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  const {
    isEnabled,
    isActive: isExecuting,
    diffStatus,
    isDeletedBlock,
    isLocked,
  } = useBlockState(blockId, currentWorkflow, data)

  const currentBlockId = usePanelEditorStore((state) => state.currentBlockId)

  const isThisBlockInEditor = currentBlockId === blockId
  const activeTabIsEditor = usePanelStore(
    useCallback(
      (state) => {
        if (isPreview || !isThisBlockInEditor) return false
        return state.activeTab === 'editor'
      },
      [isPreview, isThisBlockInEditor]
    )
  )
  const isEditorOpen = !isPreview && isThisBlockInEditor && activeTabIsEditor

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
        isExecuting: isPreview ? false : isExecuting,
        isEditorOpen: isPreview ? isPreviewSelected : isEditorOpen,
        isPending: isPreview ? false : isPending,
        isDeletedBlock: isPreview ? false : isDeletedBlock,
        diffStatus: isPreview ? undefined : diffStatus,
        runPathStatus,
        isPreviewSelection: isPreview && isPreviewSelected,
        isSelected: isPreview ? false : isSelected,
      }),
    [
      isExecuting,
      isEditorOpen,
      isPending,
      isDeletedBlock,
      diffStatus,
      runPathStatus,
      isPreview,
      isPreviewSelected,
      isSelected,
    ]
  )

  return {
    currentWorkflow,
    activeWorkflowId,
    isEnabled,
    isLocked,
    handleClick,
    hasRing,
    ringStyles,
    runPathStatus,
  }
}
