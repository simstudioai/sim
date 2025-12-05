import { useCallback, useRef } from 'react'

/**
 * History entry for code editor undo/redo.
 */
interface HistoryEntry {
  value: string
  cursorPosition: number
}

/**
 * Configuration options for the code editor history hook.
 */
interface UseCodeEditorHistoryOptions {
  /** Maximum number of history entries to keep */
  maxHistory?: number
  /** Debounce time in milliseconds for grouping changes */
  debounceMs?: number
}

/**
 * Return type for the useCodeEditorHistory hook.
 */
interface UseCodeEditorHistoryReturn {
  /** Push a new value to history (call on value change) */
  pushHistory: (value: string, cursorPosition?: number) => void
  /** Undo to previous state, returns [value, cursorPosition] or null if nothing to undo */
  undo: () => HistoryEntry | null
  /** Redo to next state, returns [value, cursorPosition] or null if nothing to redo */
  redo: () => HistoryEntry | null
  /** Check if undo is available */
  canUndo: () => boolean
  /** Check if redo is available */
  canRedo: () => boolean
  /** Reset history with initial value */
  reset: (initialValue: string) => void
  /** Handle keyboard events for undo/redo */
  handleKeyDown: (e: React.KeyboardEvent, currentValue: string) => HistoryEntry | null
}

/**
 * Custom hook to manage undo/redo history for a code editor.
 * Works with controlled components like react-simple-code-editor.
 *
 * @param options - Configuration options
 * @returns History management functions
 */
export function useCodeEditorHistory(
  options: UseCodeEditorHistoryOptions = {}
): UseCodeEditorHistoryReturn {
  const { maxHistory = 100, debounceMs = 300 } = options

  // History stacks
  const undoStack = useRef<HistoryEntry[]>([])
  const redoStack = useRef<HistoryEntry[]>([])

  // Track last value to avoid duplicate entries
  const lastValue = useRef<string>('')
  const lastPushTime = useRef<number>(0)
  const pendingEntry = useRef<HistoryEntry | null>(null)
  const debounceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * Flush any pending debounced entry to the undo stack.
   */
  const flushPending = useCallback(() => {
    if (pendingEntry.current) {
      undoStack.current.push(pendingEntry.current)
      if (undoStack.current.length > maxHistory) {
        undoStack.current.shift()
      }
      pendingEntry.current = null
    }
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current)
      debounceTimeout.current = null
    }
  }, [maxHistory])

  /**
   * Push a new value to history with debouncing.
   */
  const pushHistory = useCallback(
    (value: string, cursorPosition: number = value.length) => {
      // Skip if value hasn't changed
      if (value === lastValue.current) {
        return
      }

      const now = Date.now()
      const timeSinceLastPush = now - lastPushTime.current

      // If enough time has passed, commit the pending entry
      if (timeSinceLastPush > debounceMs) {
        flushPending()
      }

      // Store the previous value before updating
      if (lastValue.current !== '' || undoStack.current.length === 0) {
        const entry: HistoryEntry = {
          value: lastValue.current,
          cursorPosition,
        }

        // Either set as pending or add directly based on timing
        if (timeSinceLastPush <= debounceMs && pendingEntry.current) {
          // Update pending entry (group rapid changes)
          pendingEntry.current = entry
        } else {
          // Flush existing pending and set new one
          flushPending()
          pendingEntry.current = entry
        }

        // Set a timeout to flush if no more changes come
        if (debounceTimeout.current) {
          clearTimeout(debounceTimeout.current)
        }
        debounceTimeout.current = setTimeout(flushPending, debounceMs)
      }

      // Clear redo stack on new changes
      redoStack.current = []
      lastValue.current = value
      lastPushTime.current = now
    },
    [debounceMs, flushPending]
  )

  /**
   * Undo to previous state.
   */
  const undo = useCallback((): HistoryEntry | null => {
    // First flush any pending entry
    flushPending()

    if (undoStack.current.length === 0) {
      return null
    }

    // Save current state to redo stack
    redoStack.current.push({
      value: lastValue.current,
      cursorPosition: lastValue.current.length,
    })

    // Pop from undo stack
    const entry = undoStack.current.pop()!
    lastValue.current = entry.value

    return entry
  }, [flushPending])

  /**
   * Redo to next state.
   */
  const redo = useCallback((): HistoryEntry | null => {
    if (redoStack.current.length === 0) {
      return null
    }

    // Save current state to undo stack
    undoStack.current.push({
      value: lastValue.current,
      cursorPosition: lastValue.current.length,
    })

    // Pop from redo stack
    const entry = redoStack.current.pop()!
    lastValue.current = entry.value

    return entry
  }, [])

  /**
   * Check if undo is available.
   */
  const canUndo = useCallback((): boolean => {
    return undoStack.current.length > 0 || pendingEntry.current !== null
  }, [])

  /**
   * Check if redo is available.
   */
  const canRedo = useCallback((): boolean => {
    return redoStack.current.length > 0
  }, [])

  /**
   * Reset history with initial value.
   */
  const reset = useCallback((initialValue: string) => {
    undoStack.current = []
    redoStack.current = []
    pendingEntry.current = null
    lastValue.current = initialValue
    lastPushTime.current = 0
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current)
      debounceTimeout.current = null
    }
  }, [])

  /**
   * Handle keyboard events for undo/redo.
   * Returns the new history entry if an undo/redo was performed, null otherwise.
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, currentValue: string): HistoryEntry | null => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const isModKey = isMac ? e.metaKey : e.ctrlKey

      if (!isModKey) {
        return null
      }

      // Undo: Cmd/Ctrl + Z (without shift)
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()

        // Update lastValue if it changed since last push
        if (currentValue !== lastValue.current) {
          pushHistory(currentValue)
        }

        return undo()
      }

      // Redo: Cmd/Ctrl + Shift + Z or Cmd/Ctrl + Y
      if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault()
        e.stopPropagation()
        return redo()
      }

      return null
    },
    [pushHistory, undo, redo]
  )

  return {
    pushHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    reset,
    handleKeyDown,
  }
}
