'use client'

import { Suspense, useState } from 'react'
import { createLogger } from '@sim/logger'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { requestJson } from '@/lib/api/client/request'
import { resetPasswordContract } from '@/lib/api/contracts'
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
        text: error instanceof Error ? error.message : 'Failed to reset password',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <div className='space-y-1 text-center'>
        <h1 className='text-balance font-[430] font-season text-[40px] text-white leading-[110%] tracking-[-0.02em]'>
          Reset your password
        </h1>
        <p className='font-[430] font-season text-[color-mix(in_srgb,var(--landing-text-subtle)_60%,transparent)] text-lg leading-[125%] tracking-[0.02em]'>
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

      <div className='pt-6 text-center font-light text-sm'>
        <Link
          href='/login'
          className='font-medium text-[var(--landing-text)] underline-offset-4 transition hover:text-white hover:underline'
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
