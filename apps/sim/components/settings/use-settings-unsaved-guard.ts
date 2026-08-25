import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

interface UseSettingsUnsavedGuardParams {
  isDirty: boolean
  /** Embedded editors use their host's guard instead of global settings navigation. */
  enabled?: boolean
}

interface SettingsUnsavedGuard {
  showUnsavedModal: boolean
  setShowUnsavedModal: (open: boolean) => void
  guardBack: (onLeave: () => void) => void
  confirmDiscard: () => void
}

/**
 * Connects section-local dirty state to shared settings navigation guards.
 */
export function useSettingsUnsavedGuard({
  isDirty,
  enabled = true,
}: UseSettingsUnsavedGuardParams): SettingsUnsavedGuard {
  const setDirty = useSettingsDirtyStore((state) => state.setDirty)
  const reset = useSettingsDirtyStore((state) => state.reset)
  const isDirtyRef = useRef(enabled && isDirty)
  const pendingLeaveRef = useRef<(() => void) | null>(null)
  const [showUnsavedModal, setShowUnsavedModal] = useState(false)

  useEffect(() => {
    isDirtyRef.current = enabled && isDirty
    if (!enabled) {
      pendingLeaveRef.current = null
      setShowUnsavedModal(false)
      return
    }
    setDirty(isDirty)
    if (!isDirty) {
      pendingLeaveRef.current = null
      setShowUnsavedModal(false)
    }
  }, [enabled, isDirty, setDirty])

  useEffect(() => {
    if (!enabled) return
    return () => reset()
  }, [enabled, reset])

  const guardBack = useCallback((onLeave: () => void) => {
    if (isDirtyRef.current) {
      pendingLeaveRef.current = onLeave
      setShowUnsavedModal(true)
      return
    }
    onLeave()
  }, [])

  const confirmDiscard = useCallback(() => {
    setShowUnsavedModal(false)
    pendingLeaveRef.current?.()
    pendingLeaveRef.current = null
  }, [])

  return { showUnsavedModal, setShowUnsavedModal, guardBack, confirmDiscard }
}
