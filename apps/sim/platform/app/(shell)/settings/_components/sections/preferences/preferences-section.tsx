'use client'

import { useState } from 'react'
import { SectionSkeleton } from '@/platform/app/(shell)/settings/_components/section-skeleton/section-skeleton'
import styles from '@/platform/app/(shell)/settings/_components/sections/preferences/preferences-section.module.css'
import {
  Avatar,
  AvatarImage,
  Button,
  Icon,
  InlineNotice,
  Modal,
  SearchableSelect,
  Select,
  Switch,
  TextField,
} from '@/platform/design-system/components'
import { IdentityButton } from '@/platform/design-system/components/identity-button/identity-button'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import {
  useAppearanceSettings,
  useBooleanSetting,
  useProfileSettings,
  useSnapToGridSetting,
} from '@/platform/lib/data/preferences'

const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const NAME_MAX_LENGTH = 100

function LoadFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <InlineNotice
      intent='danger'
      message={message}
      action={
        <Button variant='quiet' size='compact' onClick={onRetry}>
          Retry
        </Button>
      }
    />
  )
}

function Profile() {
  const profile = useProfileSettings()
  const [editing, setEditing] = useState(false)
  if (profile.status === 'pending') return <SectionSkeleton title='Profile' />
  if (profile.status === 'error')
    return <LoadFailure message='Failed to load your profile' onRetry={profile.retry} />
  const displayName = profile.name || profile.email
  return (
    <SettingsSection title='Profile'>
      <SettingsRow label='Picture' description='PNG or JPEG, up to 5MB'>
        <IdentityButton
          label={profile.uploading ? 'Uploading profile picture' : 'Change profile picture'}
          onClick={profile.uploading ? undefined : profile.choosePicture}
          leading={
            profile.image ? (
              <span className={styles.photo}>
                <AvatarImage src={profile.image} name={displayName} />
              </span>
            ) : displayName ? (
              <Avatar name={displayName} />
            ) : (
              <Icon name='I074' />
            )
          }
        />
        <input
          ref={profile.fileInputRef}
          hidden
          type='file'
          aria-label='Set your profile picture'
          accept='image/png,image/jpeg,image/jpg'
          disabled={profile.uploading}
          onChange={profile.onPictureChange}
        />
      </SettingsRow>
      <SettingsRow label='Name' description='Set your display name'>
        <IdentityButton
          label={profile.name || 'Set name'}
          trailingIcon='I036'
          onClick={() => setEditing(true)}
        >
          {profile.name || 'Set name'}
        </IdentityButton>
        <Modal
          open={editing}
          onOpenChange={setEditing}
          variant='form'
          title='Edit display name'
          confirmLabel='Save'
          onConfirm={async (values) => {
            const value = values.get('name')
            const name = typeof value === 'string' ? value.trim() : ''
            if (name !== profile.name) await profile.saveName(name)
          }}
        >
          <TextField
            name='name'
            label='Display name'
            defaultValue={profile.name}
            maxLength={NAME_MAX_LENGTH}
            required
            pattern={'.*\\S.*'}
          />
        </Modal>
      </SettingsRow>
      <SettingsRow label='Email' description='Your account email'>
        <span data-type='T067'>{profile.email}</span>
      </SettingsRow>
    </SettingsSection>
  )
}

function Appearance() {
  const appearance = useAppearanceSettings()
  if (appearance.status === 'pending') return <SectionSkeleton title='Appearance' rows={2} />
  if (appearance.status === 'error')
    return <LoadFailure message='Failed to load your settings' onRetry={appearance.retry} />
  return (
    <SettingsSection title='Appearance'>
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
          label='Time zone'
          labelHidden
          searchLabel='Search time zones'
          options={appearance.timezoneOptions}
          value={appearance.timezoneValue}
          onValueChange={appearance.setTimezone}
        />
      </SettingsRow>
    </SettingsSection>
  )
}

function BooleanRow({
  setting,
  label,
  description,
}: {
  setting: Parameters<typeof useBooleanSetting>[0]
  label: string
  description: string
}) {
  const { checked, disabled, set } = useBooleanSetting(setting)
  return (
    <SettingsRow label={label} description={description}>
      <Switch label={label} checked={checked} disabled={disabled} onCheckedChange={set} />
    </SettingsRow>
  )
}

function WorkflowEditor() {
  const snap = useSnapToGridSetting()
  return (
    <SettingsSection title='Workflow editor'>
      <BooleanRow
        setting='autoConnect'
        label='Auto-connect on drop'
        description='Connect a dropped block to the nearest block automatically'
      />
      <BooleanRow
        setting='autoFocusOnClick'
        label='Auto-focus on click'
        description='Open a block’s editor when you click it'
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
    </SettingsSection>
  )
}

export default function PreferencesSection() {
  return (
    <>
      <Profile />
      <Appearance />
      <WorkflowEditor />
    </>
  )
}
