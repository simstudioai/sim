'use client'

import { createPreferences } from '@/platform/shared/preferences'

export const {
  useSavedSettingsRead,
  useAppearanceSettings,
  useBooleanSetting,
  useSnapToGridSetting,
  useTelemetrySetting,
} = createPreferences()
