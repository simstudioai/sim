'use client'

import { useFixtureSettings } from '@/platform/lib/data/settings-providers'
import { createPreferences } from '@/platform/shared/preferences'

export const {
  useSavedSettingsRead,
  useAppearanceSettings,
  useBooleanSetting,
  useSnapToGridSetting,
  useTelemetrySetting,
} = createPreferences(() => ({ persistTheme: !useFixtureSettings() }))
