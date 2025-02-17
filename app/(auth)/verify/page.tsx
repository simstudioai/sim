'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { client } from '@/lib/auth-client'

function VerifyContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')

  useEffect(() => {
    const token = searchParams.get('token')
    if (!token) {
      setStatus('error')
      return
    }

    client
      .verifyEmail({ query: { token } })
      .then(() => {
        setStatus('success')
        // Redirect to dashboard after a short delay
        setTimeout(() => router.push('/w/1'), 2000)
      })
      .catch(() => setStatus('error'))
  }, [searchParams, router])

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          {status === 'loading' && 'Verifying your email...'}
          {status === 'success' && 'Email verified!'}
          {status === 'error' && 'Verification failed'}
        </CardTitle>
        <CardDescription>
          {status === 'loading' && 'Please wait while we verify your email address.'}
          {status === 'success' && 'You will be redirected to the dashboard shortly.'}
          {status === 'error' && 'The verification link is invalid or has expired.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {status === 'error' && (
          <Button onClick={() => router.push('/login')} className="w-full">
            Back to login
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

export default function VerifyPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h1 className="text-2xl font-bold text-center mb-8">Sim Studio</h1>
        <Suspense
          fallback={
            <Card className="w-full">
              <CardHeader>
                <CardTitle>Loading...</CardTitle>
                <CardDescription>Please wait while we load the verification page.</CardDescription>
              </CardHeader>
            </Card>
          }
        >
          <VerifyContent />
        </Suspense>
      </div>
    </main>
  )
}
