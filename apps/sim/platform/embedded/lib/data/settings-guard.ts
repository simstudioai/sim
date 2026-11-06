'use client'

import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

/** A write somewhere in Settings is underway, so a control that would navigate waits for it. */
export function useSettingsNavigationBlocked() {
  return useSettingsDirtyStore((state) => state.navigationBlocked)
}
