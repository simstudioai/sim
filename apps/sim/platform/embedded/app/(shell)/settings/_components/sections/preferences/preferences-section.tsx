'use client'

import { FailureNotice, SearchableSelect, Select } from '@/platform/design-system/components'
import { SettingsRow } from '@/platform/design-system/components/settings-section/settings-section'
import { SectionSkeleton } from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import { ProfileForm } from '@/platform/embedded/app/(shell)/settings/_components/profile/profile-settings'
import {
  BooleanRow,
  SavedSettingsSection,
} from '@/platform/embedded/app/(shell)/settings/_components/section-parts/saved-settings'
import {
  useAppearanceSettings,
  useSnapToGridSetting,
} from '@/platform/embedded/lib/data/preferences'
import { useProfileSettings } from '@/platform/shared/preferences'

const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

function Profile() {
  const profile = useProfileSettings()
  // The profile adapter's status carries its upload state too, so it isn't one query's read.
  if (profile.status === 'pending') return <SectionSkeleton title='Profile' />
  if (profile.status === 'error')
    return <FailureNotice message='Failed to load your profile' onRetry={profile.retry} />
  return (
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

function Preferences() {
  const appearance = useAppearanceSettings()
  const snap = useSnapToGridSetting()
  return (
    <SavedSettingsSection title='Preferences' rows={7}>
      <SettingsRow label='Theme' description='Select your preferred color theme' field>
        <Select
          label='Theme'
          variant='quiet'
          options={THEMES}
          value={appearance.theme}
          onValueChange={appearance.setTheme}
        />
      </SettingsRow>
      <SettingsRow label='Time zone' description='Used for dates and schedules you read' field>
        <SearchableSelect
          variant='quiet'
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

export default function PreferencesSection() {
  return (
    <>
      <Profile />
      <Preferences />
    </>
  )
}
