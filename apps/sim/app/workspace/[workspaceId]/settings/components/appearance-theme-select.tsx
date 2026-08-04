'use client'

import type { DesktopAppearanceTheme } from '@sim/desktop-bridge'
import { ChipSelect } from '@sim/emcn'

const OPTIONS = [
  { label: 'Sim', value: 'app' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
] as const

interface AppearanceThemeSelectProps {
  value: DesktopAppearanceTheme
  onChange: (value: DesktopAppearanceTheme) => void
  disabled?: boolean
  ariaLabel: string
}

/** Settings dropdown for the device-owned browser theme. */
export function AppearanceThemeSelect({
  value,
  onChange,
  disabled,
  ariaLabel,
}: AppearanceThemeSelectProps) {
  return (
    <div className='w-[240px] flex-shrink-0'>
      <ChipSelect
        aria-label={ariaLabel}
        align='start'
        fullWidth
        dropdownWidth='trigger'
        value={value}
        onChange={(next) => onChange(next as DesktopAppearanceTheme)}
        disabled={disabled}
        options={[...OPTIONS]}
      />
    </div>
  )
}
