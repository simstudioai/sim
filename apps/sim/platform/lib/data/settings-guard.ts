'use client'

import { useSettingsLeaveLinks } from '@/components/settings/use-settings-leave-links'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

/** A full navigation: an anchor's URL already holds this app's base path, which the router would add again. */
function leaveTo(destination: URL) {
  window.location.assign(destination.href)
}

/** Asks before a link discards a draft any section registered with the shared dirty store. */
export function useLeaveConfirmation() {
  useSettingsLeaveLinks(leaveTo)
  return {
    pending: useSettingsDirtyStore((state) => state.pendingLeave !== null),
    confirm: useSettingsDirtyStore((state) => state.confirmLeave),
    cancel: useSettingsDirtyStore((state) => state.cancelLeave),
  }
}
