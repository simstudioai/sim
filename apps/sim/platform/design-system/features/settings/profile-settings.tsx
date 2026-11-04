'use client'

import { useEffect, useState } from 'react'
import {
  Icon,
  Modal,
  SettingsRow,
  SettingsSection,
  TextField,
} from '@/platform/design-system/components'
import { avatarInitials } from '@/platform/design-system/components/avatar-initials'
import styles from '@/platform/design-system/features/settings/settings.module.css'

interface ProfileSettingsProps {
  name?: string
  email?: string
}

export function ProfileSettings({ name, email }: ProfileSettingsProps) {
  const [displayName, setDisplayName] = useState(name ?? '')
  const [picture, setPicture] = useState<string>()
  useEffect(
    () => () => {
      if (picture) URL.revokeObjectURL(picture)
    },
    [picture]
  )
  return (
    <SettingsSection title='Profile'>
      <SettingsRow label='Picture' description='Set your profile picture'>
        <label className={styles.photo}>
          {picture ? (
            <img className={styles.picture} alt='' src={picture} />
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
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              if (file?.type.startsWith('image/')) setPicture(URL.createObjectURL(file))
            }}
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
            if (typeof value === 'string') setDisplayName(value.trim())
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
