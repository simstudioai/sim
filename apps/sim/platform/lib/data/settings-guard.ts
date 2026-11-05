'use client'

import { useEffect } from 'react'
import { useSettingsUnsavedGuard } from '@/components/settings/use-settings-unsaved-guard'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

/** Registers one editor with the shared settings guard, the same store legacy editors use. */
export function useUnsavedGuard(options: Parameters<typeof useSettingsUnsavedGuard>[0]) {
  return useSettingsUnsavedGuard(options)
}

/**
 * Holds a link click and a closing tab while the store has dirty drafts. A confirmed leave is a
 * full navigation: an anchor's `href` already holds this app's base path, which the router would
 * add again.
 */
export function useLeaveInterception() {
  const isDirty = useSettingsDirtyStore((state) => state.isDirty)
  const requestLeave = useSettingsDirtyStore((state) => state.requestLeave)
  useEffect(() => {
    if (!isDirty) return
    function holdLink(event: MouseEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return
      const anchor = (event.target as Element | null)?.closest?.('a[href]')
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank') return
      event.preventDefault()
      event.stopPropagation()
      const { href } = anchor
      requestLeave(() => window.location.assign(href))
    }
    function holdUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    document.addEventListener('click', holdLink, true)
    window.addEventListener('beforeunload', holdUnload)
    return () => {
      document.removeEventListener('click', holdLink, true)
      window.removeEventListener('beforeunload', holdUnload)
    }
  }, [isDirty, requestLeave])
  const pending = useSettingsDirtyStore((state) => state.pendingLeave !== null)
  return {
    pending,
    confirm: useSettingsDirtyStore((state) => state.confirmLeave),
    cancel: useSettingsDirtyStore((state) => state.cancelLeave),
  }
}
