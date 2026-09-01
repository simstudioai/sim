import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

interface UseSettingsUnsavedGuardParams {
  isDirty: boolean
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
  navigationBlocked = false,
}: UseSettingsUnsavedGuardParams): SettingsUnsavedGuard {
  const setDirty = useSettingsDirtyStore((state) => state.setDirty)
  const setNavigationBlocked = useSettingsDirtyStore((state) => state.setNavigationBlocked)
  const reset = useSettingsDirtyStore((state) => state.reset)
  const isDirtyRef = useRef(isDirty)
  const navigationBlockedRef = useRef(navigationBlocked)
  const pendingLeaveRef = useRef<(() => void) | null>(null)
  const [showUnsavedModal, setShowUnsavedModal] = useState(false)

  useEffect(() => {
    isDirtyRef.current = isDirty
    navigationBlockedRef.current = navigationBlocked
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
  }, [isDirty, navigationBlocked, setDirty, setNavigationBlocked])

  useEffect(() => {
    return () => reset()
  }, [reset])

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
