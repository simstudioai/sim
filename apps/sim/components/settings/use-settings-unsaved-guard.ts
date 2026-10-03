import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

interface UseSettingsUnsavedGuardParams {
  isDirty: boolean
  /** Embedded editors use their host's guard instead of global settings navigation. */
  enabled?: boolean
  navigationBlocked?: boolean
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
  navigationBlocked = false,
}: UseSettingsUnsavedGuardParams): SettingsUnsavedGuard {
  const setDirty = useSettingsDirtyStore((state) => state.setDirty)
  const setNavigationBlocked = useSettingsDirtyStore((state) => state.setNavigationBlocked)
  const reset = useSettingsDirtyStore((state) => state.reset)
  const isDirtyRef = useRef(enabled && isDirty)
  const navigationBlockedRef = useRef(enabled && navigationBlocked)
  const pendingLeaveRef = useRef<(() => void) | null>(null)
  const [showUnsavedModal, setShowUnsavedModal] = useState(false)

  useEffect(() => {
    isDirtyRef.current = enabled && isDirty
    navigationBlockedRef.current = enabled && navigationBlocked
    if (!enabled) {
      pendingLeaveRef.current = null
      setShowUnsavedModal(false)
      return
    }
    setDirty(isDirty)
    setNavigationBlocked(navigationBlocked)
    if (navigationBlocked) {
      pendingLeaveRef.current = null
      setShowUnsavedModal(false)
      return
    }
    if (!isDirty) {
      pendingLeaveRef.current = null
      setShowUnsavedModal(false)
    }
  }, [enabled, isDirty, navigationBlocked, setDirty, setNavigationBlocked])

  useEffect(() => {
    if (!enabled) return
    return () => reset()
  }, [enabled, reset])

  const guardBack = useCallback((onLeave: () => void) => {
    if (navigationBlockedRef.current || useSettingsDirtyStore.getState().navigationBlocked) {
      return
    }
    if (isDirtyRef.current) {
      pendingLeaveRef.current = onLeave
      setShowUnsavedModal(true)
      return
    }
    onLeave()
  }, [])

  const confirmDiscard = useCallback(() => {
    if (navigationBlockedRef.current || useSettingsDirtyStore.getState().navigationBlocked) {
      return
    }
    setShowUnsavedModal(false)
    pendingLeaveRef.current?.()
    pendingLeaveRef.current = null
  }, [])

  return { showUnsavedModal, setShowUnsavedModal, guardBack, confirmDiscard }
}
