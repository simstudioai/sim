import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

interface UseSettingsUnsavedGuardParams {
  isDirty: boolean
}

interface SettingsUnsavedGuard {
  showUnsavedModal: boolean
  setShowUnsavedModal: (open: boolean) => void
  /** Run `onLeave` immediately when clean; when dirty, open the confirm modal and defer it. */
  guardBack: (onLeave: () => void) => void
  /** Confirmed discard — close the modal and run the deferred leave action. */
  confirmDiscard: () => void
}

/**
 * Wires a settings surface's local dirty state into the shared
 * `useSettingsDirtyStore`, so the sidebar's section-switch confirmation and the
 * centralized `beforeunload` both apply without per-page wiring. Also provides
 * an in-view back/close guard (`guardBack` + the shared `UnsavedChangesModal`)
 * for detail sub-views whose "back" is an in-component state change rather than
 * a route navigation.
 */
export function useSettingsUnsavedGuard({
  isDirty,
}: UseSettingsUnsavedGuardParams): SettingsUnsavedGuard {
  const setDirty = useSettingsDirtyStore((s) => s.setDirty)
  const reset = useSettingsDirtyStore((s) => s.reset)
  const isDirtyRef = useRef(isDirty)
  const pendingLeaveRef = useRef<(() => void) | null>(null)
  const [showUnsavedModal, setShowUnsavedModal] = useState(false)

  useEffect(() => {
    isDirtyRef.current = isDirty
    setDirty(isDirty)
  }, [isDirty, setDirty])

  useEffect(() => {
    return () => reset()
  }, [reset])

  const guardBack = useCallback((onLeave: () => void) => {
    if (isDirtyRef.current) {
      pendingLeaveRef.current = onLeave
      setShowUnsavedModal(true)
    } else {
      onLeave()
    }
  }, [])

  const confirmDiscard = useCallback(() => {
    setShowUnsavedModal(false)
    pendingLeaveRef.current?.()
    pendingLeaveRef.current = null
  }, [])

  return { showUnsavedModal, setShowUnsavedModal, guardBack, confirmDiscard }
}
