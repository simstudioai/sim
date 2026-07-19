'use client'

import { Suspense, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter, useSearchParams } from 'next/navigation'
import { requestJson } from '@/lib/api/client/request'
import { resetPasswordContract } from '@/lib/api/contracts'
import { AuthHeader, AuthNavPrompt } from '@/app/(auth)/components'
import { SetNewPasswordForm } from '@/app/(auth)/reset-password/reset-password-form'

const logger = createLogger('ResetPasswordPage')

function ResetPasswordContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error' | null
    text: string
  }>({
    type: null,
    text: '',
  })

  const tokenError = !token
    ? 'Invalid or missing reset token. Please request a new password reset link.'
    : null

  const handleResetPassword = async (password: string) => {
    if (!token) return
    try {
      setIsSubmitting(true)
      setStatusMessage({ type: null, text: '' })

      await requestJson(resetPasswordContract, {
        body: {
          token,
          newPassword: password,
        },
      })

      setStatusMessage({
        type: 'success',
        text: 'Password reset successful! Redirecting to login...',
      })

      setTimeout(() => {
        router.push('/login?resetSuccess=true')
      }, 1500)
    } catch (error) {
      logger.error('Error resetting password:', { error })
      setStatusMessage({
        type: 'error',
        text: getErrorMessage(error, 'Failed to reset password'),
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className='space-y-6'>
      <AuthHeader title='Reset your password' description='Enter a new password for your account' />

      <SetNewPasswordForm
        token={token}
        onSubmit={handleResetPassword}
        isSubmitting={isSubmitting}
        statusType={tokenError ? 'error' : statusMessage.type}
        statusMessage={tokenError ?? statusMessage.text}
      />

      <AuthNavPrompt href='/login' linkLabel='Back to login' />
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className='flex h-screen items-center justify-center'>Loading…</div>}>
      <ResetPasswordContent />
    </Suspense>
  )
}
