'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useInterfacePreferences } from '@/platform/app/(shell)/_components/session/interface-preferences'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/app/(shell)/settings/_components/settings-section/settings-section'
import { Select } from '@/platform/design-system/components'
import { readAppearance } from '@/platform/design-system/navigation'

const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

export function AppearanceSettings() {
  const path = usePathname()
  const router = useRouter()
  const search = useSearchParams()
  const settings = useInterfacePreferences()
  return (
    <SettingsSection title='Appearance'>
      <SettingsRow label='Theme' description='Select your preferred color theme' field>
        <Select
          label='Theme'
          variant='quiet'
          options={THEMES}
          value={readAppearance(search.get('theme'))}
          onValueChange={(theme) => {
            const query = new URLSearchParams(search.toString())
            query.set('theme', theme)
            router.replace(`${path}?${query}`, { scroll: false })
          }}
        />
      </SettingsRow>
      <SettingsRow
        label='Interface font'
        description='Used for messages, menus, and controls'
        field
      >
        <Select
          label='Interface font'
          variant='quiet'
          options={[
            { value: 'geist', label: 'Geist' },
            { value: 'system', label: 'System' },
          ]}
          defaultValue={settings?.systemFont ? 'system' : 'geist'}
          onValueChange={(value) => settings?.setSystemFont(value === 'system')}
        />
      </SettingsRow>
      <SettingsRow label='Code font' description='Used for code blocks, logs, and terminals' field>
        <Select
          label='Code font'
          variant='quiet'
          options={[
            { value: 'geist-mono', label: 'Geist Mono' },
            { value: 'system', label: 'System monospace' },
          ]}
          defaultValue={settings?.systemMono ? 'system' : 'geist-mono'}
          onValueChange={(value) => settings?.setSystemMono(value === 'system')}
        />
      </SettingsRow>
    </SettingsSection>
  )
}
