'use client'

import type { TerminalAppearanceTheme, TerminalThemeProfile } from '@sim/desktop-bridge'
import { ChipCombobox } from '@sim/emcn'
import { withSelectedProfile } from '@/lib/desktop/appearance'

interface TerminalThemePickerProps {
  value: TerminalAppearanceTheme
  profiles: TerminalThemeProfile[]
  disabled?: boolean
  onBuiltInSelect: (theme: 'app' | 'light' | 'dark') => void
  onProfileSelect: (profile: TerminalThemeProfile) => void
}

const BUILT_INS = [
  { value: 'app', label: 'Default' },
  { value: 'light', label: 'Sim Light' },
  { value: 'dark', label: 'Sim Dark' },
] as const

function sourceLabel(source: TerminalThemeProfile['source']): string {
  return source === 'iterm2' ? 'iTerm2' : 'Terminal'
}

/** Searchable theme picker using the same ChipCombobox as General's timezone field. */
export function TerminalThemePicker({
  value,
  profiles,
  disabled,
  onBuiltInSelect,
  onProfileSelect,
}: TerminalThemePickerProps) {
  const availableProfiles = withSelectedProfile(profiles, value)
  const selectedValue = typeof value === 'string' ? value : value.id

  return (
    <div className='w-[240px] shrink-0'>
      <ChipCombobox
        aria-label='Terminal theme'
        align='start'
        searchable
        searchPlaceholder='Search themes'
        dropdownWidth={240}
        value={selectedValue}
        disabled={disabled}
        placeholder='Select theme'
        options={[
          ...BUILT_INS,
          ...availableProfiles.map((profile) => ({
            label: `${sourceLabel(profile.source)} · ${profile.name}`,
            value: profile.id,
          })),
        ]}
        onChange={(next) => {
          if (next === 'app' || next === 'light' || next === 'dark') {
            onBuiltInSelect(next)
            return
          }
          const profile = availableProfiles.find(({ id }) => id === next)
          if (profile) onProfileSelect(profile)
        }}
      />
    </div>
  )
}
