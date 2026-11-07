'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useSettingsBrowserNavigation } from '@/hooks/use-settings-browser-navigation'
import { useSettingsLeaveLinks } from '@/hooks/use-settings-leave-links'
import { publicAssetPath } from '@/platform/lib/navigation'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

const BASE_PATH = publicAssetPath('')

export function requestSettingsLeave(leave: () => void) {
  useSettingsDirtyStore.getState().requestLeave(leave)
}

/** Links are written against this zone and the router adds the base path itself. */
function zoneRoute(url: URL): string | null {
  if (!BASE_PATH) return `${url.pathname}${url.search}${url.hash}`
  if (url.pathname !== BASE_PATH && !url.pathname.startsWith(`${BASE_PATH}/`)) return null
  return `${url.pathname.slice(BASE_PATH.length) || '/'}${url.search}${url.hash}`
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
      (destination: URL) => {
        const route = zoneRoute(destination)
        if (route) router.push(route)
        else window.location.assign(destination.href)
      },
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
