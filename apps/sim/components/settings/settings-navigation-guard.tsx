'use client'

import { useCallback } from 'react'
import { ChipConfirmModal } from '@sim/emcn-legacy'
import { useRouter } from 'next/navigation'
import { useSettingsBrowserNavigation } from '@/hooks/use-settings-browser-navigation'
import { useSettingsLeaveLinks } from '@/hooks/use-settings-leave-links'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

/** One browser guard and discard dialog for every registered editor in the app. */
export function SettingsNavigationGuard() {
  useSettingsBrowserNavigation()
  const router = useRouter()
  useSettingsLeaveLinks(
    useCallback(
      (destination: URL) =>
        router.push(destination.pathname + destination.search + destination.hash),
      [router]
    )
  )
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
