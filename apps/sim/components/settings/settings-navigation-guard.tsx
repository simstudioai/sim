'use client'

import { useEffect } from 'react'
import { ChipConfirmModal } from '@sim/emcn'
import { useRouter } from 'next/navigation'
import { useSettingsBrowserNavigation } from '@/components/settings/use-settings-browser-navigation'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

/** One browser guard and discard dialog for every registered editor in the app. */
export function SettingsNavigationGuard() {
  useSettingsBrowserNavigation()
  const router = useRouter()
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const { isDirty, navigationBlocked, requestLeave } = useSettingsDirtyStore.getState()
      if (
        (!isDirty && !navigationBlocked) ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.hasAttribute('download') ||
        anchor.dataset.settingsNavigation === 'managed' ||
        (anchor.target && anchor.target !== '_self') ||
        anchor.getAttribute('aria-disabled') === 'true'
      )
        return
      if (
        event.target instanceof Element &&
        event.target.closest('button, input, textarea, select, [role="button"]')
      )
        return
      const destination = new URL(anchor.href, window.location.href)
      if (
        destination.origin !== window.location.origin ||
        (destination.pathname === window.location.pathname &&
          destination.search === window.location.search)
      )
        return
      event.preventDefault()
      event.stopImmediatePropagation()
      requestLeave(() => router.push(destination.pathname + destination.search + destination.hash))
    }
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [router])
  const pendingLeave = useSettingsDirtyStore((state) => state.pendingLeave)
  const confirmLeave = useSettingsDirtyStore((state) => state.confirmLeave)
  const cancelLeave = useSettingsDirtyStore((state) => state.cancelLeave)

  return (
    <ChipConfirmModal
      open={pendingLeave !== null}
      onOpenChange={(open) => !open && cancelLeave()}
      srTitle='Unsaved changes'
      title='Unsaved changes'
      text='You have unsaved changes. Are you sure you want to discard them?'
      dismissLabel='Keep editing'
      confirm={{ label: 'Discard changes', onClick: confirmLeave }}
    />
  )
}
