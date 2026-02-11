import { useCallback, useEffect, useMemo, useRef } from 'react'
import { createLogger } from '@sim/logger'
import { useShallow } from 'zustand/react/shallow'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useCodeUndoRedoStore } from '@/stores/undo-redo'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('CodeUndoRedo')

interface UseCodeUndoRedoOptions {
  blockId: string
  subBlockId: string
  value: string
  enabled?: boolean
  isReadOnly?: boolean
  isStreaming?: boolean
  debounceMs?: number
}

export function useCodeUndoRedo({
  blockId,
  subBlockId,
  value,
  enabled = true,
  isReadOnly = false,
  isStreaming = false,
  debounceMs = 500,
}: UseCodeUndoRedoOptions) {
  const { collaborativeSetSubblockValue } = useCollaborativeWorkflow()
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const { isShowingDiff, hasActiveDiff } = useWorkflowDiffStore(
    useShallow((state) => ({
      isShowingDiff: state.isShowingDiff,
      hasActiveDiff: state.hasActiveDiff,
    }))
  )

  const isBaselineView = hasActiveDiff && !isShowingDiff
  const isEnabled = useMemo(
    () => Boolean(enabled && activeWorkflowId && !isReadOnly && !isStreaming && !isBaselineView),
    [enabled, activeWorkflowId, isReadOnly, isStreaming, isBaselineView]
  )
  const isReplaceEnabled = useMemo(
    () => Boolean(enabled && activeWorkflowId && !isReadOnly && !isBaselineView),
    [enabled, activeWorkflowId, isReadOnly, isBaselineView]
  )

  const lastCommittedValueRef = useRef<string>(value ?? '')
  const pendingBeforeRef = useRef<string | null>(null)
  const pendingAfterRef = useRef<string | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isApplyingRef = useRef(false)

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const resetPending = useCallback(() => {
    pendingBeforeRef.current = null
    pendingAfterRef.current = null
  }, [])

  const commitPending = useCallback(() => {
    if (!isEnabled || !activeWorkflowId) {
      clearTimer()
      resetPending()
      return
    }

    const before = pendingBeforeRef.current
    const after = pendingAfterRef.current
    if (before === null || after === null) return

    if (before === after) {
      lastCommittedValueRef.current = after
      clearTimer()
      resetPending()
      return
    }

    useCodeUndoRedoStore.getState().push({
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      workflowId: activeWorkflowId,
      blockId,
      subBlockId,
      before,
      after,
    })

    lastCommittedValueRef.current = after
    clearTimer()
    resetPending()
  }, [activeWorkflowId, blockId, clearTimer, isEnabled, resetPending, subBlockId])

  const recordChange = useCallback(
    (nextValue: string) => {
      if (!isEnabled || isApplyingRef.current) return

      if (pendingBeforeRef.current === null) {
        pendingBeforeRef.current = lastCommittedValueRef.current ?? ''
      }

      pendingAfterRef.current = nextValue
      clearTimer()
      timeoutRef.current = setTimeout(commitPending, debounceMs)
    },
    [clearTimer, commitPending, debounceMs, isEnabled]
  )

  const recordReplace = useCallback(
    (nextValue: string) => {
      if (!isReplaceEnabled || isApplyingRef.current || !activeWorkflowId) return

      if (pendingBeforeRef.current !== null) {
        commitPending()
      }

      const before = lastCommittedValueRef.current ?? ''
      if (before === nextValue) {
        lastCommittedValueRef.current = nextValue
        resetPending()
        return
      }

      useCodeUndoRedoStore.getState().push({
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        workflowId: activeWorkflowId,
        blockId,
        subBlockId,
        before,
        after: nextValue,
      })

      lastCommittedValueRef.current = nextValue
      clearTimer()
      resetPending()
    },
    [
      activeWorkflowId,
      blockId,
      clearTimer,
      commitPending,
      isReplaceEnabled,
      resetPending,
      subBlockId,
    ]
  )

  const flushPending = useCallback(() => {
    if (pendingBeforeRef.current === null) return
    clearTimer()
    commitPending()
  }, [clearTimer, commitPending])

  const startSession = useCallback(
    (currentValue: string) => {
      clearTimer()
      resetPending()
      lastCommittedValueRef.current = currentValue ?? ''
    },
    [clearTimer, resetPending]
  )

  const applyValue = useCallback(
    (nextValue: string) => {
      if (!isEnabled) return
      isApplyingRef.current = true
      try {
        collaborativeSetSubblockValue(blockId, subBlockId, nextValue)
      } finally {
        isApplyingRef.current = false
      }
      lastCommittedValueRef.current = nextValue
      clearTimer()
      resetPending()
    },
    [blockId, clearTimer, collaborativeSetSubblockValue, isEnabled, resetPending, subBlockId]
  )

  const undo = useCallback(() => {
    if (!activeWorkflowId || !isEnabled) return
    if (pendingBeforeRef.current !== null) {
      flushPending()
    }
    const entry = useCodeUndoRedoStore.getState().undo(activeWorkflowId, blockId, subBlockId)
    if (!entry) return
    logger.debug('Undo code edit', { blockId, subBlockId })
    applyValue(entry.before)
  }, [activeWorkflowId, applyValue, blockId, flushPending, isEnabled, subBlockId])

  const redo = useCallback(() => {
    if (!activeWorkflowId || !isEnabled) return
    if (pendingBeforeRef.current !== null) {
      flushPending()
    }
    const entry = useCodeUndoRedoStore.getState().redo(activeWorkflowId, blockId, subBlockId)
    if (!entry) return
    logger.debug('Redo code edit', { blockId, subBlockId })
    applyValue(entry.after)
  }, [activeWorkflowId, applyValue, blockId, flushPending, isEnabled, subBlockId])

  useEffect(() => {
    if (isApplyingRef.current || isStreaming) return

    const nextValue = value ?? ''

    if (pendingBeforeRef.current !== null) {
      if (pendingAfterRef.current !== nextValue) {
        clearTimer()
        resetPending()
        lastCommittedValueRef.current = nextValue
      }
      return
    }

    lastCommittedValueRef.current = nextValue
  }, [clearTimer, isStreaming, resetPending, value])

  useEffect(() => {
    return () => {
      flushPending()
    }
  }, [flushPending])

  return {
    recordChange,
    recordReplace,
    flushPending,
    startSession,
    undo,
    redo,
  }
}
