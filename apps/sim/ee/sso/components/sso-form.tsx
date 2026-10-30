'use client'

import { useEffect, useState } from 'react'
import {
  AuthDivider,
  AuthEmailInput,
  AuthField,
  AuthHeader,
  AuthLinkButton,
  AuthNavPrompt,
  AuthStack,
} from '@sim/auth-ui'
import { createLogger } from '@sim/logger'
import { useSearchParams } from 'next/navigation'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { resolveSsoProviderContract } from '@/lib/api/contracts/auth'
import { client } from '@/lib/auth/client'
import { getEnv, isFalsy } from '@/lib/core/config/env'
import { validateCallbackUrl } from '@/lib/core/security/input-validation'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { captureClientEvent } from '@/lib/posthog/client'
import { DEFAULT_POST_AUTH_ROUTE } from '@/app/(auth)/auth-redirect'
import { AuthFormMessage, AuthLegalFooter, AuthSubmitButton } from '@/app/(auth)/components'

const logger = createLogger('SSOForm')
const SSO_SIGN_IN_ERROR = 'Unable to start SSO. Check your email and try again.'
const SSO_NO_PROVIDER_ERROR =
  'No SSO provider is configured for this email domain. Ask your administrator.'
const SSO_TEST_LINK_ERROR =
  'This sign-in link is not set up for your email domain. Ask your administrator for the right link.'
const SSO_ERROR_MESSAGES = {
  account_not_found: 'No account found. Please contact your administrator to set up SSO access.',
  sso_failed: 'SSO authentication failed. Please try again.',
  invalid_provider: 'SSO provider not configured correctly.',
  sso_no_seats:
    'Your organization has no available seat capacity. Ask an administrator to increase capacity or remove an unused member.',
  sso_account_conflict:
    'This Sim account is already a member of another organization. Leave that organization before trying again, or ask an administrator for external workspace access.',
  sso_provisioning_failed:
    'SSO succeeded, but organization access could not be set up safely. No session was created; please try again or contact your administrator.',
} as const

const validateEmailField = (emailValue: string): string[] => {
  const errors: string[] = []

  if (!emailValue || !emailValue.trim()) {
    errors.push('Email is required.')
    return errors
  }

  const validation = quickValidateEmail(emailValue.trim().toLowerCase())
  if (!validation.isValid) {
    errors.push(validation.reason || 'Please enter a valid email address.')
  }

  return errors
}

interface SSOFormProps {
  /** DISABLE_REGISTRATION. Hides the signup cross-link, which `/signup` blocks. */
  registrationDisabled: boolean
}

export default function SSOForm({ registrationDisabled }: SSOFormProps) {
  const searchParams = useSearchParams()
  const errorCode = searchParams?.get('error') ?? null
  const initialError = errorCode
    ? Object.hasOwn(SSO_ERROR_MESSAGES, errorCode)
      ? SSO_ERROR_MESSAGES[errorCode as keyof typeof SSO_ERROR_MESSAGES]
      : 'SSO authentication failed. Please try again.'
    : null

  return (
    <SSOFormContent
      key={searchParams?.toString() ?? ''}
      registrationDisabled={registrationDisabled}
      initialEmail={searchParams?.get('email') ?? ''}
      initialError={initialError}
      callbackParam={searchParams?.get('callbackUrl') ?? null}
      testProviderId={searchParams?.get('provider') || null}
    />
  )
}

interface SSOFormContentProps extends SSOFormProps {
  initialEmail: string
  initialError: string | null
  callbackParam: string | null
  /** A test sign-in link names the provider an administrator wants to try before making it primary. */
  testProviderId: string | null
}

function SSOFormContent({
  registrationDisabled,
  initialEmail,
  initialError,
  callbackParam,
  testProviderId,
}: SSOFormContentProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [email, setEmail] = useState(initialEmail)
  const [formError, setFormError] = useState(initialError)
  const [emailErrors, setEmailErrors] = useState<string[]>([])
  const [showEmailValidationError, setShowEmailValidationError] = useState(false)

  const emailEnabled = !isFalsy(getEnv('NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED'))

  /**
   * Derived during render rather than seeded into state from an effect: the
   * first painted frame otherwise carries the app-entry default, so the
   * "Sign in with email" and "Sign up" links briefly point at the wrong
   * destination on any deep link carrying `?callbackUrl=`.
   */
  const isCallbackValid = callbackParam !== null && validateCallbackUrl(callbackParam)
  const callbackUrl =
    callbackParam !== null && isCallbackValid ? callbackParam : DEFAULT_POST_AUTH_ROUTE
  const hasEmailError = showEmailValidationError && emailErrors.length > 0

  useEffect(() => {
    if (callbackParam !== null && !isCallbackValid) {
      logger.warn('Invalid callback URL detected and blocked:', { url: callbackParam })
    }
  }, [callbackParam, isCallbackValid])

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value
    setEmail(newEmail)

    const errors = validateEmailField(newEmail)
    setFormError(null)
    setEmailErrors(errors)
    setShowEmailValidationError(false)
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (isLoading) return
    setIsLoading(true)
    setFormError(null)

    const formData = new FormData(e.currentTarget)
    const emailRaw = formData.get('email') as string
    const emailValue = emailRaw.trim().toLowerCase()

    const emailValidationErrors = validateEmailField(emailValue)
    setEmailErrors(emailValidationErrors)
    setShowEmailValidationError(emailValidationErrors.length > 0)

    if (emailValidationErrors.length > 0) {
      setIsLoading(false)
      return
    }

    try {
      const safeCallbackUrl = callbackUrl

      /** Named explicitly; see `resolveSsoProviderContract` for why the domain lookup is not trusted. */
      let resolved: { providerId: string }
      try {
        resolved = await requestJson(resolveSsoProviderContract, {
          body: { email: emailValue, providerId: testProviderId ?? undefined },
        })
      } catch (error) {
        const noProvider = isApiClientError(error) && error.status === 404
        if (!noProvider) logger.error('SSO provider resolution failed', { error })
        const noProviderError = testProviderId ? SSO_TEST_LINK_ERROR : SSO_NO_PROVIDER_ERROR
        setFormError(noProvider ? noProviderError : SSO_SIGN_IN_ERROR)
        return
      }

      captureClientEvent('external_sign_in_started', { provider: 'sso', surface: 'sso_page' })
      const result = await client.signIn.sso({
        email: emailValue,
        providerId: resolved.providerId,
        callbackURL: safeCallbackUrl,
        /**
         * A failed test sign-in returns to the same test link, so a retry still reaches the provider
         * being tried. `provider` precedes `callbackUrl` because the SSO plugin appends its own error
         * with a raw `?`, which runs into whichever parameter comes last.
         */
        errorCallbackURL: `/sso?error=sso_failed${testProviderId ? `&provider=${encodeURIComponent(testProviderId)}` : ''}&callbackUrl=${encodeURIComponent(safeCallbackUrl)}`,
      })

      if (!result || result.error) {
        logger.error('SSO sign-in failed', { error: result?.error, email: emailValue })
        setFormError(SSO_SIGN_IN_ERROR)
      }
    } catch (err) {
      logger.error('SSO sign-in failed', { error: err, email: emailValue })
      setFormError(SSO_SIGN_IN_ERROR)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthStack>
      <AuthHeader title='Sign in with SSO' description='Enter your work email to continue' />
      <form onSubmit={onSubmit} className='au:space-y-5'>
        {formError && <AuthFormMessage type='error'>{formError}</AuthFormMessage>}
        <AuthField
          htmlFor='email'
          label='Work email'
          errors={showEmailValidationError ? emailErrors : undefined}
        >
          <AuthEmailInput
            id='email'
            name='email'
            type='email'
            required
            placeholder='Enter your work email'
            value={email}
            onChange={handleEmailChange}
            error={hasEmailError}
            disabled={isLoading}
          />
        </AuthField>
        <AuthSubmitButton loading={isLoading} loadingLabel='Redirecting to SSO provider…'>
          Continue with SSO
        </AuthSubmitButton>
      </form>
      {emailEnabled && (
        <>
          <AuthDivider label='Or' />
          <AuthLinkButton href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`} fullWidth>
            Sign in with email
          </AuthLinkButton>
        </>
      )}
      {emailEnabled && !registrationDisabled && (
        <AuthNavPrompt
          prompt="Don't have an account?"
          href={`/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`}
          linkLabel='Sign up'
        />
      )}
      <AuthLegalFooter action='signing in' />
    </AuthStack>
  )
}
