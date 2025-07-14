'use client'

import { Suspense, useEffect, useState } from 'react'
import { CheckCircle, Heart, Info, Loader2, XCircle } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface UnsubscribeData {
  success: boolean
  email: string
  token: string
  emailType: string
  isTransactional: boolean
  currentPreferences: {
    unsubscribeAll?: boolean
    unsubscribeMarketing?: boolean
    unsubscribeUpdates?: boolean
    unsubscribeNotifications?: boolean
  }
}

function UnsubscribeContent() {
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<UnsubscribeData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [unsubscribed, setUnsubscribed] = useState(false)

  const email = searchParams.get('email')
  const token = searchParams.get('token')

  useEffect(() => {
    if (!email || !token) {
      setError('Missing email or token in URL')
      setLoading(false)
      return
    }

    // Validate the unsubscribe link
    fetch(
      `/api/users/me/settings/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setData(data)
        } else {
          setError(data.error || 'Invalid unsubscribe link')
        }
      })
      .catch(() => {
        setError('Failed to validate unsubscribe link')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [email, token])

  const handleUnsubscribe = async (type: 'all' | 'marketing' | 'updates' | 'notifications') => {
    if (!email || !token) return

    setProcessing(true)

    try {
      const response = await fetch('/api/users/me/settings/unsubscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          token,
          type,
        }),
      })

      const result = await response.json()

      if (result.success) {
        setUnsubscribed(true)
        // Update the data to reflect the change
        if (data) {
          // Type-safe property construction with validation
          const validTypes = ['all', 'marketing', 'updates', 'notifications'] as const
          if (validTypes.includes(type)) {
            if (type === 'all') {
              setData({
                ...data,
                currentPreferences: {
                  ...data.currentPreferences,
                  unsubscribeAll: true,
                },
              })
            } else {
              const propertyKey = `unsubscribe${type.charAt(0).toUpperCase()}${type.slice(1)}` as
                | 'unsubscribeMarketing'
                | 'unsubscribeUpdates'
                | 'unsubscribeNotifications'
              setData({
                ...data,
                currentPreferences: {
                  ...data.currentPreferences,
                  [propertyKey]: true,
                },
              })
            }
          }
        }
      } else {
        setError(result.error || 'Failed to unsubscribe')
      }
    } catch (error) {
      setError('Failed to process unsubscribe request')
    } finally {
      setProcessing(false)
    }
  }

  if (loading) {
    return (
      <div className='flex min-h-screen items-center justify-center bg-background'>
        <Card className='w-full max-w-md border shadow-sm'>
          <CardContent className='flex items-center justify-center p-8'>
            <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className='flex min-h-screen items-center justify-center bg-background p-4'>
        <Card className='w-full max-w-md border shadow-sm'>
          <CardHeader className='text-center'>
            <XCircle className='mx-auto mb-2 h-12 w-12 text-red-500' />
            <CardTitle className='text-foreground'>Invalid Unsubscribe Link</CardTitle>
            <CardDescription className='text-muted-foreground'>
              This unsubscribe link is invalid or has expired
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='rounded-lg border bg-red-50 p-4'>
              <p className='text-red-800 text-sm'>
                <strong>Error:</strong> {error}
              </p>
            </div>

            <div className='space-y-3'>
              <p className='text-muted-foreground text-sm'>This could happen if:</p>
              <ul className='ml-4 list-inside list-disc space-y-1 text-muted-foreground text-sm'>
                <li>The link is missing required parameters</li>
                <li>The link has expired or been used already</li>
                <li>The link was copied incorrectly</li>
              </ul>
            </div>

            <div className='mt-6 flex flex-col gap-3'>
              <Button
                onClick={() =>
                  window.open(
                    'mailto:help@simstudio.ai?subject=Unsubscribe%20Help&body=Hi%2C%20I%20need%20help%20unsubscribing%20from%20emails.%20My%20unsubscribe%20link%20is%20not%20working.',
                    '_blank'
                  )
                }
                className='w-full bg-[#701ffc] font-medium text-white shadow-sm transition-colors duration-200 hover:bg-[#802FFF]'
              >
                Contact Support
              </Button>
              <Button onClick={() => window.history.back()} variant='outline' className='w-full'>
                Go Back
              </Button>
            </div>

            <div className='mt-4 text-center'>
              <p className='text-muted-foreground text-xs'>
                Need immediate help? Email us at{' '}
                <a href='mailto:help@simstudio.ai' className='text-primary hover:underline'>
                  help@simstudio.ai
                </a>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Handle transactional emails
  if (data?.isTransactional) {
    return (
      <div className='flex min-h-screen items-center justify-center bg-background p-4'>
        <Card className='w-full max-w-md border shadow-sm'>
          <CardHeader className='text-center'>
            <Info className='mx-auto mb-2 h-12 w-12 text-blue-500' />
            <CardTitle className='text-foreground'>Important Account Emails</CardTitle>
            <CardDescription className='text-muted-foreground'>
              This email contains important information about your account
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='rounded-lg border bg-blue-50 p-4'>
              <p className='text-blue-800 text-sm'>
                <strong>Transactional emails</strong> like password resets, account confirmations,
                and security alerts cannot be unsubscribed from as they contain essential
                information for your account security and functionality.
              </p>
            </div>

            <div className='space-y-3'>
              <p className='text-foreground text-sm'>
                If you no longer wish to receive these emails, you can:
              </p>
              <ul className='ml-4 list-inside list-disc space-y-1 text-muted-foreground text-sm'>
                <li>Close your account entirely</li>
                <li>Contact our support team for assistance</li>
              </ul>
            </div>

            <div className='mt-6 flex flex-col gap-3'>
              <Button
                onClick={() =>
                  window.open(
                    'mailto:help@simstudio.ai?subject=Account%20Help&body=Hi%2C%20I%20need%20help%20with%20my%20account%20emails.',
                    '_blank'
                  )
                }
                className='w-full bg-blue-600 text-white hover:bg-blue-700'
              >
                Contact Support
              </Button>
              <Button onClick={() => window.close()} variant='outline' className='w-full'>
                Close
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (unsubscribed) {
    return (
      <div className='flex min-h-screen items-center justify-center bg-background'>
        <Card className='w-full max-w-md border shadow-sm'>
          <CardHeader className='text-center'>
            <CheckCircle className='mx-auto mb-2 h-12 w-12 text-green-500' />
            <CardTitle className='text-foreground'>Successfully Unsubscribed</CardTitle>
            <CardDescription className='text-muted-foreground'>
              You have been unsubscribed from our emails. You will stop receiving emails within 48
              hours.
            </CardDescription>
          </CardHeader>
          <CardContent className='text-center'>
            <p className='text-muted-foreground text-sm'>
              If you change your mind, you can always update your email preferences in your account
              settings or contact us at{' '}
              <a href='mailto:help@simstudio.ai' className='text-primary hover:underline'>
                help@simstudio.ai
              </a>
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className='flex min-h-screen items-center justify-center bg-background p-4'>
      <Card className='w-full max-w-md border shadow-sm'>
        <CardHeader className='text-center'>
          <Heart className='mx-auto mb-2 h-12 w-12 text-red-500' />
          <CardTitle className='text-foreground'>We&apos;re sorry to see you go!</CardTitle>
          <CardDescription className='text-muted-foreground'>
            We understand email preferences are personal. Choose which emails you&apos;d like to
            stop receiving from Sim Studio.
          </CardDescription>
          <div className='mt-2 rounded-lg border bg-muted/50 p-3'>
            <p className='text-muted-foreground text-xs'>
              Email: <span className='font-medium text-foreground'>{data?.email}</span>
            </p>
          </div>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='space-y-3'>
            <Button
              onClick={() => handleUnsubscribe('all')}
              disabled={processing || data?.currentPreferences.unsubscribeAll}
              variant='destructive'
              className='w-full'
            >
              {processing ? (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              ) : data?.currentPreferences.unsubscribeAll ? (
                <CheckCircle className='mr-2 h-4 w-4' />
              ) : null}
              {data?.currentPreferences.unsubscribeAll
                ? 'Unsubscribed from All Emails'
                : 'Unsubscribe from All Marketing Emails'}
            </Button>

            <div className='text-center text-muted-foreground text-sm'>
              or choose specific types:
            </div>

            <Button
              onClick={() => handleUnsubscribe('marketing')}
              disabled={
                processing ||
                data?.currentPreferences.unsubscribeAll ||
                data?.currentPreferences.unsubscribeMarketing
              }
              variant='outline'
              className='w-full'
            >
              {data?.currentPreferences.unsubscribeMarketing ? (
                <CheckCircle className='mr-2 h-4 w-4' />
              ) : null}
              {data?.currentPreferences.unsubscribeMarketing
                ? 'Unsubscribed from Marketing'
                : 'Unsubscribe from Marketing Emails'}
            </Button>

            <Button
              onClick={() => handleUnsubscribe('updates')}
              disabled={
                processing ||
                data?.currentPreferences.unsubscribeAll ||
                data?.currentPreferences.unsubscribeUpdates
              }
              variant='outline'
              className='w-full'
            >
              {data?.currentPreferences.unsubscribeUpdates ? (
                <CheckCircle className='mr-2 h-4 w-4' />
              ) : null}
              {data?.currentPreferences.unsubscribeUpdates
                ? 'Unsubscribed from Updates'
                : 'Unsubscribe from Product Updates'}
            </Button>

            <Button
              onClick={() => handleUnsubscribe('notifications')}
              disabled={
                processing ||
                data?.currentPreferences.unsubscribeAll ||
                data?.currentPreferences.unsubscribeNotifications
              }
              variant='outline'
              className='w-full'
            >
              {data?.currentPreferences.unsubscribeNotifications ? (
                <CheckCircle className='mr-2 h-4 w-4' />
              ) : null}
              {data?.currentPreferences.unsubscribeNotifications
                ? 'Unsubscribed from Notifications'
                : 'Unsubscribe from Notifications'}
            </Button>
          </div>

          <div className='mt-6 space-y-3'>
            <div className='rounded-lg border bg-muted/50 p-3'>
              <p className='text-center text-muted-foreground text-xs'>
                <strong>Note:</strong> You&apos;ll continue receiving important account emails like
                password resets and security alerts.
              </p>
            </div>

            <p className='text-center text-muted-foreground text-xs'>
              Questions? Contact us at{' '}
              <a href='mailto:help@simstudio.ai' className='text-primary hover:underline'>
                help@simstudio.ai
              </a>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function UnsubscribePage() {
  return (
    <Suspense
      fallback={
        <div className='flex min-h-screen items-center justify-center bg-background'>
          <Card className='w-full max-w-md border shadow-sm'>
            <CardContent className='flex items-center justify-center p-8'>
              <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
            </CardContent>
          </Card>
        </div>
      }
    >
      <UnsubscribeContent />
    </Suspense>
  )
}
