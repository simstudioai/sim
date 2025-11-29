import { useCallback, useMemo } from 'react'
import { useBlockState } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/hooks'
import type { WorkflowBlockProps } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/types'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-current-workflow'
import { getBlockRingStyles } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/block-ring-utils'
import { useExecutionStore } from '@/stores/execution/store'
import { usePanelEditorStore } from '@/stores/panel/editor/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface UseBlockCoreOptions {
  blockId: string
  data: WorkflowBlockProps
  isPending?: boolean
}

/**
 * Consolidated hook for core block functionality shared across all block types.
 * Combines workflow state, block state, focus, and ring styling.
 */
export function useBlockCore({ blockId, data, isPending = false }: UseBlockCoreOptions) {
  // Workflow context
  const currentWorkflow = useCurrentWorkflow()
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  // Block state (enabled, active, diff status, deleted)
  const { isEnabled, isActive, diffStatus, isDeletedBlock } = useBlockState(
    blockId,
    currentWorkflow,
    data
  )

  // Run path state (from last execution)
  const lastRunPath = useExecutionStore((state) => state.lastRunPath)
  const runPathStatus = lastRunPath.get(blockId)

  // Focus management
  const setCurrentBlockId = usePanelEditorStore((state) => state.setCurrentBlockId)
  const currentBlockId = usePanelEditorStore((state) => state.currentBlockId)
  const isFocused = currentBlockId === blockId

  const handleClick = useCallback(() => {
    setCurrentBlockId(blockId)
  }, [blockId, setCurrentBlockId])

  // Ring styling based on all states
  // Priority: active (executing) > pending > focused > deleted > diff > run path
  const { hasRing, ringClassName: ringStyles } = useMemo(
    () =>
      getBlockRingStyles({
        isActive,
        isPending,
        isFocused,
        isDeletedBlock,
        diffStatus,
        runPathStatus,
      }),
    [isActive, isPending, isFocused, isDeletedBlock, diffStatus, runPathStatus]
  )

  return {
    // Workflow context
    currentWorkflow,
    activeWorkflowId,

    // Block state
    isEnabled,
    isActive,
    diffStatus,
    isDeletedBlock,

    // Focus
    isFocused,
    handleClick,

    // Ring styling
    hasRing,
    ringStyles,
    runPathStatus,
  }
}
