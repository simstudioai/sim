'use client'

import { SelectField, TextField } from '@sim/emcn/field'
import { SecretField } from '@sim/emcn/field/value-fields'
import { Modal } from '@sim/emcn/modal'
import { InlineNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import {
  EMAIL_STATUS_OPTIONS,
  PASSWORD_MODE_OPTIONS,
  useAddUserForm,
} from '@/hooks/admin/use-add-user-form'
import type { AdminUser } from '@/hooks/queries/admin-users'

interface AddUserModalProps {
  onClose: () => void
  onCreated: (user: AdminUser, resetEmailError?: string) => void
}

export function AddUserModal({ onClose, onCreated }: AddUserModalProps) {
  const form = useAddUserForm({
    onOpenChange: (open) => {
      if (!open) onClose()
    },
    onCreated,
  })
  const { addUser, isSubmissionPending } = form
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) form.handleClose()
      }}
      title='Add user'
      confirmLabel={isSubmissionPending ? 'Adding…' : 'Add user'}
      confirmDisabled={!form.canSubmit}
      pending={isSubmissionPending}
      onConfirm={() => {
        form.handleAddUser()
        return false
      }}
    >
      <TextField
        label='Name'
        placeholder='Canary Writer'
        maxLength={100}
        autoComplete='off'
        required
        value={form.name}
        error={form.nameError}
        disabled={isSubmissionPending}
        onChange={(value) => {
          form.setName(value)
          addUser.reset()
        }}
      />
      <TextField
        label='Email'
        type='email'
        placeholder='writer@synthetics.example.com'
        autoComplete='off'
        required
        value={form.email}
        error={form.emailError}
        disabled={isSubmissionPending}
        onChange={(value) => {
          form.setEmail(value)
          addUser.reset()
        }}
      />
      <SelectField
        label='Credentials'
        value={form.passwordMode}
        options={PASSWORD_MODE_OPTIONS}
        hint={
          form.setsPassword
            ? undefined
            : 'They pick their own password from the emailed reset link.'
        }
        disabled={isSubmissionPending}
        onValueChange={(value) => {
          form.setPasswordMode(value)
          addUser.reset()
        }}
      />
      {form.setsPassword && (
        <SecretField
          label='Password'
          placeholder='At least 8 characters'
          autoComplete='new-password'
          required
          value={form.password}
          error={form.passwordError}
          disabled={isSubmissionPending}
          onChange={(value) => {
            form.setPassword(value)
            addUser.reset()
          }}
        />
      )}
      <SelectField
        label='Email status'
        value={form.emailVerified ? 'verified' : 'unverified'}
        options={EMAIL_STATUS_OPTIONS}
        hint='Verified users can sign in when email verification is required.'
        disabled={isSubmissionPending}
        onValueChange={(value) => {
          form.setEmailVerified(value === 'verified')
          addUser.reset()
        }}
      />
      {addUser.error && (
        <InlineNotice
          intent='danger'
          message={getErrorMessage(addUser.error, 'Failed to add user')}
        />
      )}
    </Modal>
  )
}
