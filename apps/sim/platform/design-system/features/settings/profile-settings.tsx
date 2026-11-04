'use client'

import {
  AvatarImage,
  Icon,
  Modal,
  SettingsRow,
  SettingsSection,
  TextField,
} from '@/platform/design-system/components'
import { avatarInitials } from '@/platform/design-system/components/avatar-initials'
import { useInterfacePreferences } from '@/platform/design-system/components/interface-preferences'
import styles from '@/platform/design-system/features/settings/settings.module.css'

interface ProfileSettingsProps {
  name?: string
  email?: string
}

export function ProfileSettings({ name, email }: ProfileSettingsProps) {
  const preferences = useInterfacePreferences()
  if (!preferences) throw new Error('Profile needs interface preferences')
  const { profileName, picture, updatePicture, setProfileName } = preferences
  const displayName = profileName ?? name ?? ''
  return (
    <SettingsSection title='Profile'>
      <SettingsRow label='Picture' description='Set your profile picture'>
        <label className={styles.photo}>
          {picture ? (
            <AvatarImage src={picture} />
          ) : displayName ? (
            <span role='img' aria-label={displayName} data-type='T050'>
              {avatarInitials(displayName)}
            </span>
          ) : (
            <Icon name='I074' />
          )}
          <input
            type='file'
            aria-label='Set your profile picture'
            accept='image/*'
            onChange={(event) => updatePicture(event.currentTarget.files?.[0])}
          />
        </label>
      </SettingsRow>
      <SettingsRow label='Name' description='Set your display name'>
        <Modal
          variant='form'
          title='Edit display name'
          triggerLabel={displayName || 'Set name'}
          triggerIcon='I036'
          confirmLabel='Save'
          onConfirm={(values) => {
            const value = values.get('name')
            if (typeof value === 'string') setProfileName(value.trim())
          }}
        >
          <TextField
            name='name'
            label='Display name'
            defaultValue={displayName}
            required
            pattern={'.*\\S.*'}
          />
        </Modal>
      </SettingsRow>
      <SettingsRow label='Email' description='Your account email'>
        <span data-type='T067'>{email ?? '—'}</span>
      </SettingsRow>
    </SettingsSection>
  )
}
