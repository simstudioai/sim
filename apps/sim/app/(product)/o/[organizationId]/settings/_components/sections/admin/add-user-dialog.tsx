'use client'

import { useState } from 'react'
import { SelectField, TextField } from '@sim/emcn/field'
import { SecretField } from '@sim/emcn/field/value-fields'
import { Modal } from '@sim/emcn/modal'
import { generateId } from '@sim/utils/id'
import { isValidEmailSyntax } from '@sim/utils/string'
import { FieldStack } from '@/app/(product)/_components/settings-parts/settings-parts'
import type { DirectoryUser } from '@/app/(product)/o/[organizationId]/settings/_components/sections/admin/model'

const CREDENTIALS = [
  { value: 'set', label: 'Set a password' },
  { value: 'email', label: 'Email a reset link' },
] as const
const EMAIL_STATUS = [
  { value: 'verified', label: 'Verified' },
  { value: 'unverified', label: 'Unverified' },
] as const

interface AddUserDialogProps {
  onClose: () => void
  onAdd: (user: DirectoryUser) => void
}

export function AddUserDialog({ onClose, onAdd }: AddUserDialogProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [credentials, setCredentials] = useState('set')
  const [password, setPassword] = useState('')
  const [emailStatus, setEmailStatus] = useState('verified')
  const address = email.trim().toLowerCase()
  const validEmail = isValidEmailSyntax(address)
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title='Add user'
      confirmLabel='Add user'
      confirmDisabled={
        !name.trim() || !validEmail || (credentials === 'set' && password.length < 8)
      }
      onConfirm={() =>
        onAdd({
          id: generateId(),
          name: name.trim(),
          email: address,
          emailVerified: emailStatus === 'verified',
          role: 'user',
          banned: false,
        })
      }
    >
      <FieldStack>
        <TextField
          placeholder='Name'
          label='Name'
          required
          maxLength={100}
          value={name}
          onChange={setName}
          autoComplete='off'
        />
        <TextField
          placeholder='name@company.com'
          label='Email'
          type='email'
          required
          value={email}
          onChange={setEmail}
          autoComplete='off'
          error={email && !validEmail ? 'Enter a valid email.' : undefined}
        />
        <SelectField
          label='Credentials'
          options={CREDENTIALS}
          value={credentials}
          onValueChange={setCredentials}
          hint={
            credentials === 'email'
              ? 'They choose their password from the emailed reset link.'
              : undefined
          }
        />
        {credentials === 'set' && (
          <SecretField
            label='Password'
            value={password}
            onChange={setPassword}
            required
            autoComplete='new-password'
            placeholder='At least 8 characters'
            error={
              password && password.length < 8
                ? 'Password must be at least 8 characters.'
                : undefined
            }
          />
        )}
        <SelectField
          label='Email status'
          value={emailStatus}
          options={EMAIL_STATUS}
          onValueChange={setEmailStatus}
          hint='Verified users can sign in when email verification is required.'
        />
      </FieldStack>
    </Modal>
  )
}
