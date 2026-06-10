import { useCallback, useRef, useState } from 'react'

interface UseInlineRenameProps {
  onSave: (id: string, newName: string) => void | Promise<void>
}

/**
 * Multiplexed (id-keyed) inline rename, used across resource rows (tables, files,
 * knowledge) via {@link ResourceCell.editing}. This is the across-rows variant of
 * the sidebar's single-item `useItemRename`; it mirrors that hook's save flow:
 * `submitRename` is async and flips an `isSaving` flag during `await onSave`
 * (the analogue of `useItemRename`'s `isRenaming`), while the `doneRef` guard keeps
 * a blur racing an Enter/Escape commit a harmless no-op.
 *
 * TODO: the resource rename still intermittently unfocuses; the deeper re-render
 * cause (parent remounting the editing cell) is tracked separately. This hook is
 * aligned to the proven sidebar pattern as the first step.
 */
export function useInlineRename({ onSave }: UseInlineRenameProps) {
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  const originalNameRef = useRef('')
  const doneRef = useRef(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const editingIdRef = useRef(editingId)
  editingIdRef.current = editingId
  const [editValue, setEditValue] = useState('')
  const editValueRef = useRef(editValue)
  editValueRef.current = editValue
  const [isSaving, setIsSaving] = useState(false)

  const startRename = useCallback((id: string, currentName: string) => {
    doneRef.current = false
    setEditingId(id)
    /**
     * Sync the ref eagerly (not just via the render-time assignment) so an
     * in-flight save's `finally` that resolves before the next render still
     * sees this id as the active edit and leaves the new session alone.
     */
    editingIdRef.current = id
    setEditValue(currentName)
    originalNameRef.current = currentName
    setIsSaving(false)
  }, [])

  const submitRename = useCallback(async () => {
    if (doneRef.current) return
    doneRef.current = true
    const id = editingIdRef.current
    const trimmed = editValueRef.current.trim()
    if (!id || !trimmed || trimmed === originalNameRef.current) {
      setEditingId(null)
      return
    }
    setIsSaving(true)
    try {
      await onSaveRef.current(id, trimmed)
    } finally {
      /**
       * Only clear editing state if this submit still owns the edit session.
       * Without the guard, a slow save for row A would tear down a rename of
       * row B started while A's save was in flight. A superseded submit's
       * cleanup is a no-op — `startRename` already reset `isSaving` for the
       * new session, and the new session's own submit handles its lifecycle.
       */
      if (editingIdRef.current === id) {
        setIsSaving(false)
        setEditingId(null)
      }
    }
  }, [])

  const cancelRename = useCallback(() => {
    doneRef.current = true
    setEditingId(null)
  }, [])

  return {
    editingId,
    editValue,
    isSaving,
    setEditValue,
    startRename,
    submitRename,
    cancelRename,
  }
}
