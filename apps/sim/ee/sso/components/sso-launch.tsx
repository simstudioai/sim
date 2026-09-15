'use client'

import { useEffect, useRef } from 'react'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import { client } from '@/lib/auth/auth-client'
import { DEFAULT_POST_AUTH_ROUTE } from '@/app/(auth)/auth-redirect'
import { AuthHeader } from '@/app/(auth)/components'

const logger = createLogger('SSOLaunch')

interface SSOLaunchProps {
  /** A provider whose own identity provider opened its initiate login URL. */
  providerId: string
}

/**
 * Starts SSO through a provider as soon as its identity provider's app dashboard opens Sim, with no
 * email to enter. A sign-in that cannot start, or that fails at the identity provider, returns to the
 * provider's sign-in link with the error. `provider` precedes `callbackUrl` there because the SSO
 * plugin appends its own error with a raw `?`, which runs into whichever parameter comes last.
 */
export function SSOLaunch({ providerId }: SSOLaunchProps) {
  const router = useRouter()
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const failureUrl = `/sso?error=sso_failed&provider=${encodeURIComponent(providerId)}&callbackUrl=${encodeURIComponent(DEFAULT_POST_AUTH_ROUTE)}`
    void client.signIn
      .sso({ providerId, callbackURL: DEFAULT_POST_AUTH_ROUTE, errorCallbackURL: failureUrl })
      .then((result) => {
        if (result && !result.error) return
        logger.error('SSO sign-in failed to start', { error: result?.error, providerId })
        router.replace(failureUrl)
      })
      .catch((error) => {
        logger.error('SSO sign-in failed to start', { error, providerId })
        router.replace(failureUrl)
      })
  }, [providerId, router])

  return (
    <AuthHeader title='Sign in with SSO' description='Redirecting to your identity provider…' />
  )
}
