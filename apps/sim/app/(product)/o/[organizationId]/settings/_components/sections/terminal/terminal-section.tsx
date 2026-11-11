'use client'

import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { Select } from '@sim/emcn/picker/select'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import { SwitchRow } from '@/app/(product)/_components/settings-parts/switch-row'
import {
  DESKTOP_THEME_OPTIONS,
  DESKTOP_ZOOM_PERCENTS,
  type DesktopAppearanceTheme,
  type DesktopPreferences,
  type DesktopZoomPercent,
  isDesktopZoomPercent,
  loadDesktopTerminalThemeProfiles,
  type TerminalThemeProfile,
  useDesktopPreferenceMutation,
  useDesktopRead,
  withSelectedProfile,
} from '@/platform/lib/data/desktop'

const ZOOM_OPTIONS = DESKTOP_ZOOM_PERCENTS.map((zoom) => ({
  label: `${zoom}%`,
  value: String(zoom),
}))

function sourceLabel(source: TerminalThemeProfile['source']): string {
  return source === 'iterm2' ? 'iTerm2' : 'Terminal'
}

interface TerminalData {
  preferences: DesktopPreferences
  profiles: TerminalThemeProfile[]
}

/** The built-in terminal on this device. Without the desktop terminal it opens Preferences. */
export default function TerminalSection() {
  const { data, setData, failed, retry } = useDesktopRead(
    async (bridge): Promise<TerminalData> => {
      const [preferences, profiles] = await Promise.all([
        bridge.settings.getPreferences(),
        loadDesktopTerminalThemeProfiles(),
      ])
      return { preferences, profiles }
    },
    (bridge) => Boolean(bridge.terminal)
  )
  const setPreferences = (preferences: DesktopPreferences) =>
    setData((current) => current && { ...current, preferences })

  const { pending: togglePending, mutate: setEnabled } = useDesktopPreferenceMutation(
    (bridge, enabled: boolean) => bridge.settings.setPreference('terminalEnabled', enabled),
    'Could not update terminal settings',
    setPreferences
  )
  // A missing profile resolves without preferences; report it as the same failure a rejection does.
  const { pending: profilePending, mutate: selectProfile } = useDesktopPreferenceMutation(
    async (bridge, profile: TerminalThemeProfile) => {
      if (!bridge.terminalThemes) return undefined
      const next = await bridge.terminalThemes.selectProfile(profile.id)
      if (!next) throw new Error('unknown terminal theme profile')
      return next
    },
    'Could not select that terminal theme',
    setPreferences
  )
  const { pending: builtInThemePending, mutate: setTheme } = useDesktopPreferenceMutation(
    (bridge, theme: DesktopAppearanceTheme) => bridge.settings.setTerminalTheme(theme),
    'Could not update terminal appearance',
    setPreferences
  )
  const { pending: zoomPending, mutate: setDefaultZoom } = useDesktopPreferenceMutation(
    (bridge, zoom: DesktopZoomPercent) => bridge.settings.setTerminalDefaultZoom(zoom),
    'Could not update the default terminal zoom',
    setPreferences
  )

  if (failed)
    return (
      <>
        <SettingsPageHeader />
        <FailureNotice message='Could not load terminal settings' onRetry={retry} />
      </>
    )
  if (!data) return <SettingsPageHeader />

  const { preferences } = data
  const theme = preferences.terminalTheme
  const profiles = withSelectedProfile(data.profiles, theme)
  const themeOptions = [
    ...DESKTOP_THEME_OPTIONS,
    ...profiles.map((profile) => ({
      label: `${sourceLabel(profile.source)} · ${profile.name}`,
      value: profile.id,
    })),
  ]

  return (
    <>
      <SettingsPageHeader />
      <SettingsSection title='Built-in terminal'>
        <SwitchRow
          label='Let Chat run commands'
          description='Chat can run commands in a terminal on this computer'
          checked={preferences.terminalEnabled}
          disabled={togglePending}
          onCheckedChange={(checked) => void setEnabled(checked)}
        />
        <SettingsRow label='Theme' description='Select the terminal’s color theme' field>
          <SearchableSelect
            label='Terminal theme'
            labelHidden
            searchLabel='Search themes'
            placeholder='Select theme'
            options={themeOptions}
            value={typeof theme === 'string' ? theme : theme.id}
            disabled={profilePending || builtInThemePending}
            onValueChange={(next) => {
              const builtIn = DESKTOP_THEME_OPTIONS.find((option) => option.value === next)
              if (builtIn) {
                void setTheme(builtIn.value)
                return
              }
              const profile = profiles.find(({ id }) => id === next)
              if (profile) void selectProfile(profile)
            }}
          />
        </SettingsRow>
        <SettingsRow label='Default zoom' description='Text size for new terminal sessions' field>
          <Select
            label='Terminal default zoom'
            options={ZOOM_OPTIONS}
            value={String(preferences.terminalDefaultZoom)}
            disabled={zoomPending}
            onValueChange={(value) => {
              const zoom = Number.parseInt(value, 10)
              if (isDesktopZoomPercent(zoom)) void setDefaultZoom(zoom)
            }}
          />
        </SettingsRow>
      </SettingsSection>
    </>
  )
}
