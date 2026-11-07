'use client'

import { type ChangeEventHandler, useRef, useState } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { TextField } from '@sim/emcn/field'
import { Icon } from '@sim/emcn/icon'
import { IdentityButton } from '@sim/emcn/identity-button'
import { Modal } from '@sim/emcn/modal'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { useInterfacePreferences } from '@/platform/app/(shell)/_components/session/interface-preferences'
import { toast } from '@/platform/lib/data/toast'

const NAME_MAX_LENGTH = 100
const MAX_PICTURE_BYTES = 5 * 1024 * 1024
const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp']

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
            placeholder='Your name'
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

interface ProfileSettingsProps {
  name?: string
  email?: string
  image?: string | null
}

export function ProfileSettings({ name, email, image }: ProfileSettingsProps) {
  const preferences = useInterfacePreferences()
  if (!preferences) throw new Error('Profile needs interface preferences')
  return (
    <ProfileForm
      name={preferences.profileName ?? name ?? ''}
      email={email ?? ''}
      picture={preferences.picture ?? image}
      onSaveName={preferences.setProfileName}
      onPictureChange={({ currentTarget }) => {
        const file = currentTarget.files?.[0]
        if (!file) return
        if (file.size > MAX_PICTURE_BYTES) {
          toast.error(`File "${file.name}" is too large. Maximum size is 5MB.`)
        } else if (!PICTURE_TYPES.includes(file.type)) {
          toast.error(`File "${file.name}" is not a supported image format.`)
        } else {
          preferences.updatePicture(file)
        }
        currentTarget.value = ''
      }}
    />
  )
}
