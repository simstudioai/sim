'use client'

import { type ChangeEventHandler, useRef, useState } from 'react'
import { Avatar, Icon, Modal, TextField } from '@/platform/design-system/components'
import { IdentityButton } from '@/platform/design-system/components/identity-button/identity-button'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'

const NAME_MAX_LENGTH = 100

interface ProfileFormProps {
  name: string
  email: string
  picture?: string | null
  uploading?: boolean
  onPictureChange: ChangeEventHandler<HTMLInputElement>
  onSaveName: (name: string) => void | Promise<void>
}

export function ProfileForm({
  name,
  email,
  picture,
  uploading,
  onPictureChange,
  onSaveName,
}: ProfileFormProps) {
  const picker = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const displayName = name || email
  return (
    <SettingsSection title='Profile'>
      <SettingsRow label='Picture' description='PNG or JPEG, up to 5MB'>
        <IdentityButton
          label={uploading ? 'Uploading profile picture' : 'Change profile picture'}
          onClick={uploading ? undefined : () => picker.current?.click()}
          leading={
            displayName ? (
              <Avatar name={displayName} src={picture ?? undefined} />
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
          accept='image/png,image/jpeg,image/jpg'
          disabled={uploading}
          onChange={onPictureChange}
        />
      </SettingsRow>
      <SettingsRow label='Name' description='Set your display name'>
        <IdentityButton
          label={name || 'Set name'}
          trailingIcon='I036'
          onClick={() => setEditing(true)}
        >
          {name || 'Set name'}
        </IdentityButton>
        <Modal
          open={editing}
          onOpenChange={setEditing}
          variant='form'
          title='Edit display name'
          confirmLabel='Save'
          onConfirm={async (values) => {
            const value = values.get('name')
            const nextName = typeof value === 'string' ? value.trim() : ''
            if (nextName !== name) await onSaveName(nextName)
          }}
        >
          <TextField
            name='name'
            label='Display name'
            defaultValue={name}
            maxLength={NAME_MAX_LENGTH}
            required
            pattern={'.*\\S.*'}
          />
        </Modal>
      </SettingsRow>
      <SettingsRow label='Email' description='Your account email'>
        <span data-type='T067'>{email || '—'}</span>
      </SettingsRow>
    </SettingsSection>
  )
}
