'use client'

import { useRef, useState } from 'react'
import { isValidEmailSyntax } from '@sim/utils/string'
import { type AdminUser, useAddUser } from '@/hooks/queries/admin-users'

export const EMAIL_STATUS_OPTIONS = [
  { value: 'verified', label: 'Verified' },
  { value: 'unverified', label: 'Unverified' },
] as const

export const PASSWORD_MODE_OPTIONS = [
  { value: 'set', label: 'Set a password' },
  { value: 'email', label: 'Email a reset link' },
] as const

export type PasswordMode = (typeof PASSWORD_MODE_OPTIONS)[number]['value']

interface AddUserFormOptions {
  onOpenChange: (open: boolean) => void
  onCreated: (user: AdminUser, resetEmailError?: string) => void
}

/** A new account's draft. The password stays in this form's state and leaves only in the request. */
export function useAddUserForm({ onOpenChange, onCreated }: AddUserFormOptions) {
  const addUser = useAddUser()
  const submissionInFlightRef = useRef(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [passwordMode, setPasswordMode] = useState<PasswordMode>('set')
  const [password, setPassword] = useState('')
  const [emailVerified, setEmailVerified] = useState(true)

  const setsPassword = passwordMode === 'set'
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
    (!setsPassword || password.length >= 8) &&
    !isSubmissionPending

  const reset = () => {
    setName('')
    setEmail('')
    setPasswordMode('set')
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
        emailVerified,
        ...(setsPassword ? { password } : {}),
      },
      {
        onSuccess: ({ user, resetEmailError }) => {
          reset()
          onOpenChange(false)
          onCreated(user, resetEmailError)
        },
        onSettled: () => {
          submissionInFlightRef.current = false
          setIsSubmitting(false)
        },
      }
    )
  }

  return {
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
  }
}
