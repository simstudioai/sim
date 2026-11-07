'use client'

import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn-legacy'
import { getErrorMessage } from '@sim/utils/errors'
import {
  EMAIL_STATUS_OPTIONS,
  PASSWORD_MODE_OPTIONS,
  type PasswordMode,
  useAddUserForm,
} from '@/app/workspace/[workspaceId]/settings/components/admin/use-add-user-form'
import type { AdminUser } from '@/hooks/queries/admin-users'

interface AddUserModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The account was created. `resetEmailError` is set when its provisioning
   * reset email could not be sent — the account still exists, so the host is
   * expected to surface the user (and report this) rather than treat it as a
   * failed create.
   */
  onCreated: (user: AdminUser, resetEmailError?: string) => void
}

export function AddUserModal({ open, onOpenChange, onCreated }: AddUserModalProps) {
  const {
    addUser,
    canSubmit,
    email,
    emailError,
    emailVerified,
    handleAddUser,
    handleClose,
    isSubmissionPending,
    name,
    nameError,
    password,
    passwordError,
    passwordMode,
    setEmail,
    setEmailVerified,
    setName,
    setPassword,
    setPasswordMode,
    setsPassword,
  } = useAddUserForm({ onOpenChange, onCreated })

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
          type='dropdown'
          title='Credentials'
          value={passwordMode}
          onChange={(value) => {
            setPasswordMode(value as PasswordMode)
            addUser.reset()
          }}
          options={PASSWORD_MODE_OPTIONS}
          align='start'
          hint={
            setsPassword ? undefined : 'They pick their own password from the emailed reset link.'
          }
          disabled={isSubmissionPending}
          required
        />
        {setsPassword && (
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
            placeholder='At least 8 characters'
            autoComplete='new-password'
            disabled={isSubmissionPending}
            required
          />
        )}
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
