'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { createLogger } from '@/lib/logs/console/logger'
import { SetNewPasswordForm } from './reset-password-form'

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

  // Validate token presence
  useEffect(() => {
    if (!token) {
      setStatusMessage({
        type: 'error',
        text: 'Invalid or missing reset token. Please request a new password reset link.',
      })
    }
  }, [token])

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

      // Redirect to login page after 1.5 seconds
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
    <main className='flex min-h-screen flex-col items-center justify-center bg-gray-50'>
      <div className='sm:mx-auto sm:w-full sm:max-w-md'>
        <h1 className='mb-8 text-center font-bold text-2xl'>Sim Studio</h1>
        <Card className='w-full'>
          <CardHeader>
            <CardTitle>Reset your password</CardTitle>
            <CardDescription>Enter a new password for your account</CardDescription>
          </CardHeader>
          <CardContent>
            <SetNewPasswordForm
              token={token}
              onSubmit={handleResetPassword}
              isSubmitting={isSubmitting}
              statusType={statusMessage.type}
              statusMessage={statusMessage.text}
            />
          </CardContent>
          <CardFooter>
            <p className='w-full text-center text-gray-500 text-sm'>
              <Link href='/login' className='text-primary hover:underline'>
                Back to login
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </main>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={<div className='flex min-h-screen items-center justify-center'>Loading...</div>}
    >
      <ResetPasswordContent />
    </Suspense>
  )
}
