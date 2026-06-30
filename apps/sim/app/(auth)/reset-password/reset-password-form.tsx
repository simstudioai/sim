'use client'

import { useState } from 'react'
import { cn } from '@/lib/core/utils/cn'
import {
  AuthField,
  AuthFormMessage,
  AuthSubmitButton,
  PasswordInput,
} from '@/app/(auth)/components'

interface SetNewPasswordFormProps {
  token: string | null
  onSubmit: (password: string) => Promise<void>
  isSubmitting: boolean
  statusType: 'success' | 'error' | null
  statusMessage: string
  className?: string
}

export function SetNewPasswordForm({
  token,
  onSubmit,
  isSubmitting,
  statusType,
  statusMessage,
  className,
}: SetNewPasswordFormProps) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [validationMessages, setValidationMessages] = useState<string[]>([])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const errors: string[] = []

    if (password.length < 8) {
      errors.push('Password must be at least 8 characters long')
    }

    if (password.length > 100) {
      errors.push('Password must not exceed 100 characters')
    }

    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter')
    }

    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter')
    }

    if (!/[0-9]/.test(password)) {
      errors.push('Password must contain at least one number')
    }

    if (!/[^A-Za-z0-9]/.test(password)) {
      errors.push('Password must contain at least one special character')
    }

    if (password !== confirmPassword) {
      errors.push('Passwords do not match')
    }

    if (errors.length > 0) {
      setValidationMessages(errors)
      return
    }

    setValidationMessages([])
    onSubmit(password)
  }

  const hasValidationErrors = validationMessages.length > 0

  return (
    <form onSubmit={handleSubmit} className={cn('space-y-6', className)}>
      <div className='space-y-5'>
        <AuthField htmlFor='password' label='New Password'>
          <PasswordInput
            id='password'
            autoCapitalize='none'
            autoComplete='new-password'
            autoCorrect='off'
            disabled={isSubmitting || !token}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder='Enter new password'
            error={hasValidationErrors}
          />
        </AuthField>
        <AuthField htmlFor='confirmPassword' label='Confirm Password'>
          <PasswordInput
            id='confirmPassword'
            autoCapitalize='none'
            autoComplete='new-password'
            autoCorrect='off'
            disabled={isSubmitting || !token}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            placeholder='Confirm new password'
            error={hasValidationErrors}
          />
        </AuthField>

        {hasValidationErrors && (
          <AuthFormMessage type='error'>
            {validationMessages.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </AuthFormMessage>
        )}

        {statusType && statusMessage && (
          <AuthFormMessage type={statusType === 'success' ? 'success' : 'error'}>
            <p>{statusMessage}</p>
          </AuthFormMessage>
        )}
      </div>

      <AuthSubmitButton
        loading={isSubmitting}
        loadingLabel='Resetting…'
        disabled={!token || password.length === 0 || confirmPassword.length === 0}
      >
        Reset Password
      </AuthSubmitButton>
    </form>
  )
}
