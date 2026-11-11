'use client'

import type { ReactNode } from 'react'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { Select } from '@sim/emcn/picker/select'
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

/** The profile read's pending and failed states around the form it fills. */
function ProfileRead({
  profile,
  children,
}: {
  profile: ReturnType<typeof useProfileSettings>
  children: ReactNode
}) {
  if (profile.status === 'pending') return <SettingsSection title='Profile' />
  if (profile.status === 'error')
    return <FailureNotice message='Failed to load your profile' onRetry={profile.retry} />
  return children
}

/** The viewer's profile, saved to their account. */
export function LiveProfile() {
  const profile = useProfileSettings()
  return (
    <ProfileRead profile={profile}>
      <ProfileForm
        name={profile.name}
        email={profile.email}
        picture={profile.image}
        uploading={profile.uploading}
        onSaveName={profile.saveName}
        onPictureChange={profile.onPictureChange}
      />
    </ProfileRead>
  )
}

/** The fixture viewer's profile, edited for this interface session only. */
export function SessionProfile() {
  const profile = useProfileSettings()
  return (
    <ProfileRead profile={profile}>
      <ProfileSettings name={profile.name} email={profile.email} image={profile.image} />
    </ProfileRead>
  )
}

interface ThemeRowProps {
  value: string | undefined
  onValueChange: (value: string) => void
}

function ThemeRow({ value, onValueChange }: ThemeRowProps) {
  return (
    <SettingsRow label='Theme' description='Select your preferred color theme' field>
      <Select label='Theme' options={THEMES} value={value} onValueChange={onValueChange} />
    </SettingsRow>
  )
}

/** The theme saved to the viewer's account. */
export function LiveThemeRow() {
  const appearance = useAppearanceSettings()
  return <ThemeRow value={appearance.theme} onValueChange={appearance.setTheme} />
}

/** A fixture's theme, kept in the URL so a check can open the page in either appearance. */
export function SessionThemeRow() {
  const [theme, setTheme] = useQueryState(
    fixtureAppearanceParam.key,
    fixtureAppearanceParam.parser.withOptions({ history: 'replace', scroll: false })
  )
  return (
    <ThemeRow
      value={theme ?? undefined}
      onValueChange={(value) => {
        if (value === 'system' || value === 'light' || value === 'dark') void setTheme(value)
      }}
    />
  )
}

/** Theme (`theme`, filled by the route) and time zone. */
export function AppearanceSection({ theme }: { theme: ReactNode }) {
  const appearance = useAppearanceSettings()
  return (
    <SavedSettingsSection title='Appearance'>
      {theme}
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
    </SavedSettingsSection>
  )
}

export function CanvasSection() {
  const snap = useSnapToGridSetting()
  return (
    <SavedSettingsSection title='Canvas'>
      <BooleanRow
        setting='autoConnect'
        label='Auto-connect on drop'
        description='Connect a dropped block to the nearest block automatically'
      />
      <BooleanRow
        setting='autoFocusOnClick'
        label='Auto-focus on click'
        description='Center the canvas on a block when you click it'
      />
      <BooleanRow
        setting='errorNotificationsEnabled'
        label='Canvas error notifications'
        description='Show error popups on blocks when a workflow run fails'
      />
      <SettingsRow label='Snap to grid' description='Align blocks to a grid as you move them' field>
        <Select
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
