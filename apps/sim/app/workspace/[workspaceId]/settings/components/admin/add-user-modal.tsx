'use client'

import { useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { isValidEmailSyntax } from '@sim/utils/string'
import { type AddUserInput, type AdminUser, useAddUser } from '@/hooks/queries/admin-users'

const ROLE_OPTIONS = [
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Platform admin' },
] as const

const EMAIL_STATUS_OPTIONS = [
  { value: 'verified', label: 'Verified' },
  { value: 'unverified', label: 'Unverified' },
] as const

interface AddUserModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (user: AdminUser) => void
}

export function AddUserModal({ open, onOpenChange, onCreated }: AddUserModalProps) {
  const addUser = useAddUser()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<AddUserInput['role']>('user')
  const [emailVerified, setEmailVerified] = useState(true)

  const normalizedName = name.trim()
  const normalizedEmail = email.trim().toLowerCase()
  const nameError = name.length > 0 && !normalizedName ? 'Name is required' : undefined
  const emailError =
    email.length > 0 && !isValidEmailSyntax(normalizedEmail) ? 'Enter a valid email' : undefined
  const passwordError =
    password.length > 0 && password.length < 8
      ? 'Password must be at least 8 characters'
      : undefined
  const canSubmit =
    normalizedName.length > 0 &&
    isValidEmailSyntax(normalizedEmail) &&
    password.length >= 8 &&
    !addUser.isPending

  const reset = () => {
    setName('')
    setEmail('')
    setPassword('')
    setRole('user')
    setEmailVerified(true)
    addUser.reset()
  }

  const handleClose = () => {
    if (addUser.isPending) return
    reset()
    onOpenChange(false)
  }

  const handleAddUser = () => {
    if (!canSubmit) return
    addUser.reset()
    addUser.mutate(
      {
        name: normalizedName,
        email: normalizedEmail,
        password,
        role,
        emailVerified,
      },
      {
        onSuccess: (user) => {
          reset()
          onOpenChange(false)
          onCreated(user)
        },
      }
    )
  }

  return (
    <ChipModal
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose()
      }}
      srTitle='Add user'
    >
      <ChipModalHeader onClose={handleClose}>Add user</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='input'
          title='Name'
          value={name}
          onChange={(value) => {
            setName(value)
            addUser.reset()
          }}
          error={nameError}
          placeholder='Canary Writer'
          maxLength={100}
          autoComplete='off'
          disabled={addUser.isPending}
          required
        />
        <ChipModalField
          type='email'
          title='Email'
          value={email}
          onChange={(value) => {
            setEmail(value)
            addUser.reset()
          }}
          error={emailError}
          placeholder='writer@synthetics.example.com'
          autoComplete='off'
          disabled={addUser.isPending}
          required
        />
        <ChipModalField
          type='input'
          inputType='password'
          title='Password'
          value={password}
          onChange={(value) => {
            setPassword(value)
            addUser.reset()
          }}
          error={passwordError}
          hint='Better Auth creates a credential account with this password.'
          placeholder='At least 8 characters'
          autoComplete='new-password'
          disabled={addUser.isPending}
          required
        />
        <ChipModalField
          type='dropdown'
          title='Platform role'
          value={role}
          onChange={(value) => {
            setRole(value as AddUserInput['role'])
            addUser.reset()
          }}
          options={ROLE_OPTIONS}
          align='start'
          disabled={addUser.isPending}
          required
        />
        <ChipModalField
          type='dropdown'
          title='Email status'
          value={emailVerified ? 'verified' : 'unverified'}
          onChange={(value) => {
            setEmailVerified(value === 'verified')
            addUser.reset()
          }}
          options={EMAIL_STATUS_OPTIONS}
          align='start'
          hint='Verified users can sign in when email verification is required.'
          disabled={addUser.isPending}
          required
        />
        <ChipModalError>
          {addUser.error ? getErrorMessage(addUser.error, 'Failed to add user') : null}
        </ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={handleClose}
        cancelDisabled={addUser.isPending}
        primaryAction={{
          label: addUser.isPending ? 'Adding...' : 'Add user',
          onClick: handleAddUser,
          disabled: !canSubmit,
        }}
      />
    </ChipModal>
  )
}
