'use client'

import { useEffect } from 'react'
import { ChipConfirmModal } from '@sim/emcn'
import { useRouter } from 'next/navigation'
import { useSettingsBrowserNavigation } from '@/components/settings/use-settings-browser-navigation'
import { inAppLinkDestination } from '@/lib/core/utils/in-app-link'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

/** One browser guard and discard dialog for every registered editor in the app. */
export function SettingsNavigationGuard() {
  useSettingsBrowserNavigation()
  const router = useRouter()
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const { isDirty, navigationBlocked, requestLeave } = useSettingsDirtyStore.getState()
      if (!isDirty && !navigationBlocked) return
      const destination = inAppLinkDestination(event)
      if (!destination) return
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
