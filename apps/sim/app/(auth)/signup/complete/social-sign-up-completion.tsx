'use client'

import { useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { useSession } from '@/lib/auth/client'
import type { SocialSignInProvider } from '@/lib/auth/social-sign-in'
import { trackSignUpCompletionConversions } from '@/lib/auth/social-sign-up-conversion'
import { useTrackingConsent } from '@/lib/consent/tracking-consent'
import { validateCallbackUrl } from '@/lib/core/security/input-validation'
import { DEFAULT_POST_AUTH_ROUTE } from '@/app/(auth)/auth-redirect'

interface SocialSignUpCompletionProps {
  consentRequired: boolean
}

function isSignUpConversionMethod(value: string | null): value is SocialSignInProvider | 'email' {
  return value === 'email' || value === 'github' || value === 'google' || value === 'microsoft'
}

export function SocialSignUpCompletion({ consentRequired }: SocialSignUpCompletionProps) {
  const redirectStartedRef = useRef(false)
  const searchParams = useSearchParams()
  const { data: session, isPending } = useSession()
  const { isResolved, measurement, marketing } = useTrackingConsent()
  const callbackURL = searchParams.get('callbackURL')
  const destination =
    callbackURL && validateCallbackUrl(callbackURL) ? callbackURL : DEFAULT_POST_AUTH_ROUTE
  const marker = searchParams.get('conversion')
  const provider = searchParams.get('provider')

  useEffect(() => {
    if (redirectStartedRef.current || isPending || (consentRequired && !isResolved)) return
    redirectStartedRef.current = true

    const finishSignUp = async () => {
      if (session?.user && isSignUpConversionMethod(provider)) {
        await trackSignUpCompletionConversions({
          marker,
          method: provider,
          userId: session.user.id,
          measurement: consentRequired && measurement,
          marketing: consentRequired && marketing,
        })
      }
      window.location.href = destination
    }

    void finishSignUp()
  }, [
    consentRequired,
    destination,
    isPending,
    isResolved,
    marker,
    measurement,
    marketing,
    provider,
    session,
  ])

  return <p className='text-center text-[var(--text-secondary)] text-sm'>Finishing signup…</p>
}
