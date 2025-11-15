import { useCallback, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { useExecutionStore } from '@/stores/execution/store'
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
  // Priority: active (animated) > pending > focused > deleted > diff > run path
  const { hasRing, ringStyles } = useMemo(() => {
    const hasRing =
      isActive ||
      isPending ||
      isFocused ||
      diffStatus === 'new' ||
      diffStatus === 'edited' ||
      isDeletedBlock ||
      !!runPathStatus

    const ringStyles = cn(
      // Executing block: animated ring cycling through gray tones (animation handles all styling)
      isActive && 'animate-ring-pulse',
      // Non-active states use standard ring utilities
      !isActive && hasRing && 'ring-[1.75px]',
      // Pending state: warning ring
      !isActive && isPending && 'ring-[var(--warning)]',
      // Focused (selected) state: brand ring
      !isActive && !isPending && isFocused && 'ring-[var(--brand-secondary)]',
      // Deleted state (highest priority after active/pending/focused)
      !isActive && !isPending && !isFocused && isDeletedBlock && 'ring-[var(--text-error)]',
      // Diff states
      !isActive &&
        !isPending &&
        !isFocused &&
        !isDeletedBlock &&
        diffStatus === 'new' &&
        'ring-[#22C55E]',
      !isActive &&
        !isPending &&
        !isFocused &&
        !isDeletedBlock &&
        diffStatus === 'edited' &&
        'ring-[var(--warning)]',
      // Run path states (lowest priority - only show if no other states active)
      !isActive &&
        !isPending &&
        !isFocused &&
        !isDeletedBlock &&
        !diffStatus &&
        runPathStatus === 'success' &&
        'ring-[var(--surface-14)]',
      !isActive &&
        !isPending &&
        !isFocused &&
        !isDeletedBlock &&
        !diffStatus &&
        runPathStatus === 'error' &&
        'ring-[var(--text-error)]'
    )

    return { hasRing, ringStyles }
  }, [isActive, isPending, isFocused, diffStatus, isDeletedBlock, runPathStatus])

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
