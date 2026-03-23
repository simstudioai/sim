'use client'

import { Suspense, useState } from 'react'
import { createLogger } from '@sim/logger'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
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
    try {
      setIsSubmitting(true)
      setStatusMessage({ type: null, text: '' })

      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          newPassword: password,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Failed to reset password')
      }

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
        text: error instanceof Error ? error.message : 'Failed to reset password',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <div className='space-y-1 text-center'>
        <h1 className='font-[430] font-season text-[40px] text-white leading-[110%] tracking-[-0.02em]'>
          Reset your password
        </h1>
        <p className='font-[430] font-season text-[#F6F6F6]/60 text-[18px] leading-[125%] tracking-[0.02em]'>
          Enter a new password for your account
        </p>
      </div>

      <div className='mt-8'>
        <SetNewPasswordForm
          token={token}
          onSubmit={handleResetPassword}
          isSubmitting={isSubmitting}
          statusType={tokenError ? 'error' : statusMessage.type}
          statusMessage={tokenError ?? statusMessage.text}
        />
      </div>

      <div className='pt-6 text-center font-light text-[14px]'>
        <Link
          href='/login'
          className='font-medium text-[#ECECEC] underline-offset-4 transition hover:text-white hover:underline'
        >
          Back to login
        </Link>
      </div>
    </>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={<div className='flex h-screen items-center justify-center'>Loading...</div>}
    >
      <ResetPasswordContent />
    </Suspense>
  )
}
