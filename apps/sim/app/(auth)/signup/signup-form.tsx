'use client'

import { Suspense, useEffect, useMemo, useRef } from 'react'
import { createLogger } from '@sim/logger'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { validateCallbackUrl } from '@/lib/core/security/input-validation'
import { captureClientEvent } from '@/lib/posthog/client'
import { SocialLoginButtons } from '@/app/(auth)/components/social-login-buttons'
import { SSOLoginButton } from '@/app/(auth)/components/sso-login-button'

const logger = createLogger('SignupForm')

interface SignupFormProps {
  githubAvailable: boolean
  googleAvailable: boolean
  microsoftAvailable: boolean
  isProduction: boolean
}

function SignupFormContent({
  githubAvailable,
  googleAvailable,
  microsoftAvailable,
  isProduction,
}: SignupFormProps) {
  const searchParams = useSearchParams()
  const invalidCallbackRef = useRef(false)

  useEffect(() => {
    captureClientEvent('signup_page_viewed', {})
  }, [])

  const rawRedirectUrl = searchParams.get('redirect') || searchParams.get('callbackUrl') || ''
  const isValidRedirectUrl = rawRedirectUrl ? validateCallbackUrl(rawRedirectUrl) : false
  if (rawRedirectUrl && !isValidRedirectUrl && !invalidCallbackRef.current) {
    invalidCallbackRef.current = true
    logger.warn('Invalid callback URL detected and blocked:', { url: rawRedirectUrl })
  }
  const redirectUrl = isValidRedirectUrl ? rawRedirectUrl : ''
  const isInviteFlow = useMemo(
    () =>
      searchParams.get('invite_flow') === 'true' ||
      redirectUrl.startsWith('/invite/') ||
      redirectUrl.startsWith('/credential-account/'),
    [searchParams, redirectUrl]
  )

  const ssoEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))
  const hasSocial = githubAvailable || googleAvailable || microsoftAvailable
  const callbackURL = redirectUrl || '/workspace'

  return (
    <>
      <div className='space-y-1 text-center'>
        <h1 className='text-balance font-[430] font-season text-[40px] text-white leading-[110%] tracking-[-0.02em]'>
          Create an account
        </h1>
        <p className='font-[430] font-season text-[color-mix(in_srgb,var(--landing-text-subtle)_60%,transparent)] text-lg leading-[125%] tracking-[0.02em]'>
          Sign up with your preferred provider
        </p>
      </div>

      {ssoEnabled && !hasSocial ? (
        <div className='mt-8'>
          <SSOLoginButton callbackURL={callbackURL} variant='primary' />
        </div>
      ) : (
        <div className='mt-8'>
          <SocialLoginButtons
            githubAvailable={githubAvailable}
            googleAvailable={googleAvailable}
            microsoftAvailable={microsoftAvailable}
            callbackURL={callbackURL}
            isProduction={isProduction}
          >
            {ssoEnabled && <SSOLoginButton callbackURL={callbackURL} variant='outline' />}
          </SocialLoginButtons>
        </div>
      )}

      <div className='pt-6 text-center font-light text-sm'>
        <span className='font-normal'>Already have an account? </span>
        <Link
          href={isInviteFlow ? `/login?invite_flow=true&callbackUrl=${redirectUrl}` : '/login'}
          className='font-medium text-[var(--landing-text)] underline-offset-4 transition hover:text-white hover:underline'
        >
          Sign in
        </Link>
      </div>

      <div className='absolute right-0 bottom-0 left-0 px-8 pb-8 text-center font-[340] text-[var(--landing-text-muted)] text-small leading-relaxed sm:px-8 md:px-11'>
        By creating an account, you agree to our{' '}
        <Link
          href='/terms'
          target='_blank'
          rel='noopener noreferrer'
          className='text-[var(--landing-text-muted)] underline-offset-4 transition hover:text-[var(--landing-text)] hover:underline'
        >
          Terms of Service
        </Link>{' '}
        and{' '}
        <Link
          href='/privacy'
          target='_blank'
          rel='noopener noreferrer'
          className='text-[var(--landing-text-muted)] underline-offset-4 transition hover:text-[var(--landing-text)] hover:underline'
        >
          Privacy Policy
        </Link>
      </div>
    </>
  )
}

export default function SignupPage({
  githubAvailable,
  googleAvailable,
  microsoftAvailable,
  isProduction,
}: SignupFormProps) {
  return (
    <Suspense fallback={<div className='flex h-screen items-center justify-center'>Loading…</div>}>
      <SignupFormContent
        githubAvailable={githubAvailable}
        googleAvailable={googleAvailable}
        microsoftAvailable={microsoftAvailable}
        isProduction={isProduction}
      />
    </Suspense>
  )
}
