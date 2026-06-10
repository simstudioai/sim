import { useCallback, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'

const logger = createLogger('useInlineRename')

interface UseInlineRenameProps {
  /**
   * Persists the new name. Return the mutation promise (e.g. React Query's
   * `mutateAsync(...)`) — NOT a fire-and-forget `mutate(...)` — so `isSaving`
   * spans the in-flight request and a rejection can revive the edit session.
   */
  onSave: (id: string, newName: string) => undefined | Promise<unknown>
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
      /**
       * Only clear editing state if this submit still owns the edit session.
       * Without the guard, a slow save for row A would tear down a rename of
       * row B started while A's save was in flight. A superseded submit's
       * cleanup is a no-op — `startRename` already reset `isSaving` for the
       * new session, and the new session's own submit handles its lifecycle.
       */
      if (editingIdRef.current === id) {
        setEditingId(null)
      }
    } catch (error) {
      logger.error('Failed to rename item', { error, id, newName: trimmed })
      /**
       * Mirror `useItemRename`'s failure path: stay in edit mode with the
       * original name restored (no silent data loss, no unhandled rejection)
       * and re-arm `doneRef` so the revived session can submit or cancel again.
       */
      if (editingIdRef.current === id) {
        setEditValue(originalNameRef.current)
        doneRef.current = false
      }
    } finally {
      if (editingIdRef.current === id) {
        setIsSaving(false)
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
