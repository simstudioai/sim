'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useSettingsBrowserNavigation } from '@/hooks/use-settings-browser-navigation'
import { useSettingsLeaveLinks } from '@/hooks/use-settings-leave-links'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

export function requestSettingsLeave(leave: () => void) {
  useSettingsDirtyStore.getState().requestLeave(leave)
}

/**
 * The one owner of leaving an unsaved Settings draft: it holds links and browser traversal, warns
 * on a document unload, and answers the shared discard dialog. Editors only register themselves,
 * through `useSettingsUnsavedGuard`, so a discard covers every dirty editor at once.
 */
export function useSettingsLeaveGuard() {
  const router = useRouter()
  useSettingsBrowserNavigation()
  useSettingsLeaveLinks(
    useCallback(
      (destination: URL) =>
        router.push(`${destination.pathname}${destination.search}${destination.hash}`),
      [router]
    )
  )
  return {
    pending: useSettingsDirtyStore((state) => state.pendingLeave !== null),
    confirm: useSettingsDirtyStore((state) => state.confirmLeave),
    cancel: useSettingsDirtyStore((state) => state.cancelLeave),
  }
}

/** A write somewhere in Settings is underway, so a control that would navigate waits for it. */
export function useSettingsNavigationBlocked() {
  return useSettingsDirtyStore((state) => state.navigationBlocked)
}
