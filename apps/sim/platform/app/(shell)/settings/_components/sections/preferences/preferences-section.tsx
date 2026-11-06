'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  ProfileForm,
  ProfileSettings,
} from '@/platform/app/(shell)/settings/_components/profile/profile-settings'
import {
  BooleanRow,
  SavedSettingsSection,
} from '@/platform/app/(shell)/settings/_components/section-parts/saved-settings'
import { SectionSkeleton } from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import { FailureNotice, SearchableSelect, Select } from '@/platform/design-system/components'
import { SettingsRow } from '@/platform/design-system/components/settings-section/settings-section'
import { readAppearance } from '@/platform/design-system/navigation'
import { useAppearanceSettings, useSnapToGridSetting } from '@/platform/lib/data/preferences'
import { useProfileSettings } from '@/platform/shared/preferences'

const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

interface PreferencesSectionProps {
  fixture?: boolean
}

function Profile({ fixture }: PreferencesSectionProps) {
  const profile = useProfileSettings()
  if (profile.status === 'pending') return <SectionSkeleton title='Profile' />
  if (profile.status === 'error')
    return <FailureNotice message='Failed to load your profile' onRetry={profile.retry} />
  return fixture ? (
    <ProfileSettings name={profile.name} email={profile.email} image={profile.image} />
  ) : (
    <ProfileForm
      name={profile.name}
      email={profile.email}
      picture={profile.image}
      uploading={profile.uploading}
      onSaveName={profile.saveName}
      onPictureChange={profile.onPictureChange}
    />
  )
}

function Preferences({ fixture }: PreferencesSectionProps) {
  const router = useRouter()
  const path = usePathname()
  const search = useSearchParams()
  const appearance = useAppearanceSettings()
  const snap = useSnapToGridSetting()
  return (
    <SavedSettingsSection title='Preferences' rows={7}>
      <SettingsRow label='Theme' description='Select your preferred color theme' field>
        <Select
          label='Theme'
          variant='quiet'
          options={THEMES}
          value={fixture ? readAppearance(search.get('theme')) : appearance.theme}
          onValueChange={(value) => {
            if (!fixture) return appearance.setTheme(value)
            const query = new URLSearchParams(search.toString())
            query.set('theme', value)
            router.replace(`${path}?${query}`, { scroll: false })
          }}
        />
      </SettingsRow>
      <SettingsRow label='Time zone' description='Used for dates and schedules you read' field>
        <SearchableSelect
          label='Time zone'
          labelHidden
          searchLabel='Search time zones'
          options={appearance.timezoneOptions}
          value={appearance.timezoneValue}
          onValueChange={appearance.setTimezone}
        />
      </SettingsRow>
      <BooleanRow
        setting='autoConnect'
        label='Auto-connect on drop'
        description='Connect a dropped block to the nearest block automatically'
        preview='auto-connect-on-drop'
      />
      <BooleanRow
        setting='autoFocusOnClick'
        label='Auto-focus on click'
        description='Center the canvas on a block when you click it'
        preview='auto-focus-on-click'
      />
      <BooleanRow
        setting='errorNotificationsEnabled'
        label='Canvas error notifications'
        description='Show error popups on blocks when a workflow run fails'
        preview='canvas-error-notification'
      />
      <SettingsRow label='Snap to grid' description='Align blocks to a grid as you move them' field>
        <Select
          label='Snap to grid'
          variant='quiet'
          options={snap.options}
          value={snap.value}
          disabled={snap.disabled}
          onValueChange={snap.set}
        />
      </SettingsRow>
      <BooleanRow
        setting='showActionBar'
        label='Show canvas controls'
        description='Show the zoom and layout controls on the canvas'
      />
    </SavedSettingsSection>
  )
}

export default function PreferencesSection({ fixture }: PreferencesSectionProps) {
  return (
    <>
      <Profile fixture={fixture} />
      <Preferences fixture={fixture} />
    </>
  )
}
