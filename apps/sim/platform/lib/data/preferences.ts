'use client'

import { useMemo } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { getTimezoneOptions } from '@/lib/core/utils/timezone'
import {
  getTimezonePickerPresentation,
  timezonePreferenceFromPickerValue,
} from '@/lib/core/utils/timezone-picker'
import {
  getBrowserTelemetryPreference,
  setBrowserTelemetryPreference,
} from '@/lib/telemetry/browser-preference'
import { toast } from '@/lib/toast/sink'
import type { GeneralSettings } from '@/hooks/queries/current-user-data'
import { useGeneralSettings, useUpdateGeneralSetting } from '@/hooks/queries/general-settings'
import { useFixtureSettings } from '@/platform/lib/data/settings-providers'
import { useBrowserTimezone } from '@/platform/shared/preferences'
import { queryView } from '@/platform/shared/query-view'

const SNAP_TO_GRID_VALUES = [0, 10, 20, 30, 40, 50] as const

const SNAP_TO_GRID_OPTIONS = SNAP_TO_GRID_VALUES.map((size) => ({
  value: String(size),
  label: size === 0 ? 'Off' : `${size}px`,
}))

type BooleanSetting = {
  [K in keyof GeneralSettings]: GeneralSettings[K] extends boolean ? K : never
}[keyof GeneralSettings]

/** Fixture settings keep the saved theme out of the host's theme store. */
function useSettingsOptions() {
  return { persistTheme: !useFixtureSettings() }
}

function usePlatformSettings() {
  return useGeneralSettings(useSettingsOptions())
}
function useWritePlatformSetting() {
  return useUpdateGeneralSetting(useSettingsOptions())
}

/** A saved setting's write, which reports its failure; the optimistic value rolls itself back. */
function useSettingWriter() {
  const update = useWritePlatformSetting()
  return {
    pending: update.isPending,
    write: (variables: Parameters<typeof update.mutate>[0]) =>
      update.mutate(variables, {
        onError: (error) => toast.error(getErrorMessage(error, 'Could not save this setting')),
      }),
  }
}

export function useSavedSettingsRead() {
  return queryView(usePlatformSettings())
}

export function useAppearanceSettings() {
  const settings = usePlatformSettings()
  const { write } = useSettingWriter()
  const browserTimezone = useBrowserTimezone()
  const savedTimezone = settings.data?.timezone ?? null
  const timezone = useMemo(
    () => getTimezonePickerPresentation(savedTimezone, browserTimezone, getTimezoneOptions()),
    [savedTimezone, browserTimezone]
  )
  return {
    theme: settings.data?.theme ?? 'system',
    setTheme: (value: string) => {
      if (value === 'system' || value === 'light' || value === 'dark')
        write({ key: 'theme', value })
    },
    timezoneValue: timezone.value,
    timezoneOptions: timezone.options,
    setTimezone: (value: string | null) => {
      const preference = value === null ? undefined : timezonePreferenceFromPickerValue(value)
      if (preference !== undefined) write({ key: 'timezone', value: preference })
    },
  }
}

export function useBooleanSetting(key: BooleanSetting) {
  const settings = usePlatformSettings()
  const { write, pending } = useSettingWriter()
  const checked = settings.data?.[key]
  return {
    checked: checked ?? false,
    disabled: !settings.data || pending,
    set: (value: boolean) => {
      if (value !== checked) write({ key, value })
    },
  }
}

export function useSnapToGridSetting() {
  const settings = usePlatformSettings()
  const { write, pending } = useSettingWriter()
  const size = settings.data?.snapToGridSize ?? 0
  return {
    options: SNAP_TO_GRID_OPTIONS,
    value: String(size),
    disabled: !settings.data || pending,
    set: (value: string) => {
      const next = Number.parseInt(value, 10)
      if (next !== size) write({ key: 'snapToGridSize', value: next })
    },
  }
}

/**
 * Browser telemetry stops first and resumes only once the account says so, so a failed save can
 * never leave collection on after an opt-out.
 */
export function useTelemetrySetting(fixture = false) {
  const settings = usePlatformSettings()
  const update = useWritePlatformSetting()
  const enabled = settings.data?.telemetryEnabled
  return {
    checked: enabled ?? true,
    disabled: !settings.data || update.isPending,
    set: async (value: boolean) => {
      if (value === enabled || update.isPending) return
      if (fixture) {
        update.mutate({ key: 'telemetryEnabled', value })
        return
      }
      const previous = getBrowserTelemetryPreference()
      setBrowserTelemetryPreference(false)
      try {
        await update.mutateAsync({ key: 'telemetryEnabled', value })
        setBrowserTelemetryPreference(value)
      } catch (error) {
        setBrowserTelemetryPreference(previous)
        toast.error(getErrorMessage(error, 'Could not save your telemetry preference'))
      }
    },
  }
}
