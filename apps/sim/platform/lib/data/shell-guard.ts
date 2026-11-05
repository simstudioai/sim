'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

const BASE_PATH = process.env.NEXT_PUBLIC_SIM_PLATFORM_BASE_PATH ?? ''

/** Links are written against this zone; the router adds the base path itself. */
function zoneRoute(url: URL): string | null {
  if (url.origin !== window.location.origin) return null
  if (!BASE_PATH) return `${url.pathname}${url.search}${url.hash}`
  if (url.pathname !== BASE_PATH && !url.pathname.startsWith(`${BASE_PATH}/`)) return null
  return `${url.pathname.slice(BASE_PATH.length) || '/'}${url.search}${url.hash}`
}

/**
 * Holds any link the viewer follows while a Settings draft is unsaved, and warns on a document
 * unload. Navigation through history is not held: the legacy traversal guard lives in a settings
 * component this seam cannot import.
 */
export function useSettingsLeaveGuard() {
  const router = useRouter()
  const pending = useSettingsDirtyStore((state) => state.pendingLeave !== null)
  const confirm = useSettingsDirtyStore((state) => state.confirmLeave)
  const cancel = useSettingsDirtyStore((state) => state.cancelLeave)

  useEffect(() => {
    function holdLink(event: MouseEvent) {
      const { isDirty, navigationBlocked, requestLeave } = useSettingsDirtyStore.getState()
      if (
        (!isDirty && !navigationBlocked) ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      )
        return
      const anchor = event.target.closest('a[href]')
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.hasAttribute('download') ||
        (anchor.target && anchor.target !== '_self') ||
        event.target.closest('button, input, textarea, select, [role="button"]')
      )
        return
      const destination = new URL(anchor.href, window.location.href)
      if (
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search
      )
        return
      event.preventDefault()
      event.stopImmediatePropagation()
      const route = zoneRoute(destination)
      requestLeave(() => {
        if (route) router.push(route)
        else window.location.assign(destination.href)
      })
    }
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      const { isDirty, navigationBlocked } = useSettingsDirtyStore.getState()
      if (isDirty || navigationBlocked) event.preventDefault()
    }
    document.addEventListener('click', holdLink, true)
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => {
      document.removeEventListener('click', holdLink, true)
      window.removeEventListener('beforeunload', warnBeforeUnload)
    }
  }, [router])

  return { pending, confirm, cancel }
}
