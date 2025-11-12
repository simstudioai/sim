import { useCallback, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { usePanelEditorStore } from '@/stores/panel-new/editor/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useBlockState } from '../components/workflow-block/hooks'
import type { WorkflowBlockProps } from '../components/workflow-block/types'
import { useCurrentWorkflow } from './use-current-workflow'

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

  // Focus management
  const setCurrentBlockId = usePanelEditorStore((state) => state.setCurrentBlockId)
  const currentBlockId = usePanelEditorStore((state) => state.currentBlockId)
  const isFocused = currentBlockId === blockId

  const handleClick = useCallback(() => {
    setCurrentBlockId(blockId)
  }, [blockId, setCurrentBlockId])

  // Ring styling based on all states
  const { hasRing, ringStyles } = useMemo(() => {
    const hasRing =
      isActive ||
      isPending ||
      isFocused ||
      diffStatus === 'new' ||
      diffStatus === 'edited' ||
      isDeletedBlock

    const ringStyles = cn(
      hasRing && 'ring-[1.75px]',
      isActive && 'ring-[#8C10FF] animate-pulse-ring',
      isPending && 'ring-[var(--warning)]',
      isFocused && 'ring-[var(--brand-secondary)]',
      diffStatus === 'new' && 'ring-[#22C55F]',
      diffStatus === 'edited' && 'ring-[var(--warning)]',
      isDeletedBlock && 'ring-[var(--text-error)]'
    )

    return { hasRing, ringStyles }
  }, [isActive, isPending, isFocused, diffStatus, isDeletedBlock])

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
  }
}
