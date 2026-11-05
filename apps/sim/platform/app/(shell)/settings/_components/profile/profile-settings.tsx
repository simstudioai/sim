'use client'

import { useRef, useState } from 'react'
import { useInterfacePreferences } from '@/platform/app/(shell)/_components/session/interface-preferences'
import styles from '@/platform/app/(shell)/settings/_components/profile/profile-settings.module.css'
import { Avatar, AvatarImage, Icon, Modal, TextField } from '@/platform/design-system/components'
import { IdentityButton } from '@/platform/design-system/components/identity-button/identity-button'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'

interface ProfileSettingsProps {
  name?: string
  email?: string
}

export function ProfileSettings({ name, email }: ProfileSettingsProps) {
  const [editing, setEditing] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const preferences = useInterfacePreferences()
  if (!preferences) throw new Error('Profile needs interface preferences')
  const { profileName, picture, updatePicture, setProfileName } = preferences
  const displayName = profileName ?? name ?? ''
  return (
    <SettingsSection title='Profile'>
      <SettingsRow label='Picture' description='Set your profile picture'>
        <IdentityButton
          label='Change profile picture'
          onClick={() => picker.current?.click()}
          leading={
            picture ? (
              <span className={styles.photo}>
                <AvatarImage src={picture} name={displayName} />
              </span>
            ) : displayName ? (
              <Avatar name={displayName} />
            ) : (
              <Icon name='I074' />
            )
          }
        />
        <input
          ref={picker}
          hidden
          type='file'
          aria-label='Set your profile picture'
          accept='image/*'
          onChange={(event) => updatePicture(event.currentTarget.files?.[0])}
        />
      </SettingsRow>
      <SettingsRow label='Name' description='Set your display name'>
        <IdentityButton
          label={displayName || 'Set name'}
          trailingIcon='I036'
          onClick={() => setEditing(true)}
        >
          {displayName || 'Set name'}
        </IdentityButton>
        <Modal
          open={editing}
          onOpenChange={setEditing}
          variant='form'
          title='Edit display name'
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
