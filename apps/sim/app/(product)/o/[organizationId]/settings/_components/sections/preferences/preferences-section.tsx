'use client'

import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { useQueryState } from 'nuqs'
import {
  BooleanRow,
  SavedSettingsSection,
} from '@/app/(product)/_components/settings-parts/saved-settings'
import {
  ProfileForm,
  ProfileSettings,
} from '@/app/(product)/o/[organizationId]/settings/_components/profile/profile-settings'
import { useAppearanceSettings, useSnapToGridSetting } from '@/platform/lib/data/preferences'
import { fixtureAppearanceParam } from '@/platform/lib/navigation'
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
  if (profile.status === 'pending') return <SettingsSection title='Profile' />
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
  const [fixtureTheme, setFixtureTheme] = useQueryState(
    fixtureAppearanceParam.key,
    fixtureAppearanceParam.parser.withOptions({ history: 'replace', scroll: false })
  )
  const appearance = useAppearanceSettings()
  const snap = useSnapToGridSetting()
  return (
    <SavedSettingsSection title='Preferences'>
      <SettingsRow label='Theme' description='Select your preferred color theme'>
        <ChoiceMenu
          label='Theme'
          options={THEMES}
          value={fixture ? fixtureTheme : appearance.theme}
          onValueChange={(value) => {
            if (!fixture) return appearance.setTheme(value)
            if (value === 'system' || value === 'light' || value === 'dark')
              void setFixtureTheme(value)
          }}
        />
      </SettingsRow>
      <SettingsRow label='Time zone' description='Used for dates and schedules you read'>
        <SearchableSelect
          variant='text'
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
      <SettingsRow label='Snap to grid' description='Align blocks to a grid as you move them'>
        <ChoiceMenu
          label='Snap to grid'
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
