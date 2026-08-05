'use client'

import { useRef, useState } from 'react'
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
import { type AdminUser, useAddUser } from '@/hooks/queries/admin-users'

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
  const submissionInFlightRef = useRef(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
  const isSubmissionPending = isSubmitting || addUser.isPending
  const canSubmit =
    normalizedName.length > 0 &&
    isValidEmailSyntax(normalizedEmail) &&
    password.length >= 8 &&
    !isSubmissionPending

  const reset = () => {
    setName('')
    setEmail('')
    setPassword('')
    setEmailVerified(true)
    addUser.reset()
  }

  const handleClose = () => {
    if (submissionInFlightRef.current || isSubmissionPending) return
    reset()
    onOpenChange(false)
  }

  const handleAddUser = () => {
    if (!canSubmit || submissionInFlightRef.current) return
    submissionInFlightRef.current = true
    setIsSubmitting(true)
    addUser.reset()
    addUser.mutate(
      {
        name: normalizedName,
        email: normalizedEmail,
        password,
        emailVerified,
      },
      {
        onSuccess: (user) => {
          reset()
          onOpenChange(false)
          onCreated(user)
        },
        onSettled: () => {
          submissionInFlightRef.current = false
          setIsSubmitting(false)
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
      <ChipModalHeader onClose={handleClose} closeDisabled={isSubmissionPending}>
        Add user
      </ChipModalHeader>
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
          disabled={isSubmissionPending}
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
          disabled={isSubmissionPending}
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
          disabled={isSubmissionPending}
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
          disabled={isSubmissionPending}
          required
        />
        <ChipModalError>
          {addUser.error ? getErrorMessage(addUser.error, 'Failed to add user') : null}
        </ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={handleClose}
        cancelDisabled={isSubmissionPending}
        primaryAction={{
          label: isSubmissionPending ? 'Adding...' : 'Add user',
          onClick: handleAddUser,
          disabled: !canSubmit,
        }}
      />
    </ChipModal>
  )
}
