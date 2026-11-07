'use client'

import { useState } from 'react'
import { GithubIcon, GoogleIcon, MicrosoftIcon } from '@sim/emcn/brand/provider-icon'
import { AuthButton as Chip } from '@sim/emcn-auth/button'
import { AuthFormMessage } from '@sim/emcn-auth/feedback'
import { AuthProviderGroup, AuthStack } from '@sim/emcn-auth/stack'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type SocialSignInProvider, startSocialSignIn } from '@/lib/auth/social-sign-in'
import { DEFAULT_POST_AUTH_ROUTE } from '@/app/(auth)/auth-redirect'
import { SSOLoginButton } from '@/app/(auth)/components/sso-login-button'

const logger = createLogger('SocialLoginButtons')

interface SocialLoginButtonsProps {
  githubAvailable: boolean
  googleAvailable: boolean
  microsoftAvailable: boolean
  view: 'login' | 'signup'
  callbackURL?: string
  ssoEnabled?: boolean
  disabled?: boolean
}

/** Display order of the provider buttons. */
const PROVIDERS = [
  { provider: 'google', label: 'Google', icon: GoogleIcon },
  { provider: 'microsoft', label: 'Microsoft', icon: MicrosoftIcon },
  { provider: 'github', label: 'GitHub', icon: GithubIcon },
] as const

export function SocialLoginButtons({
  githubAvailable,
  googleAvailable,
  microsoftAvailable,
  view,
  callbackURL = DEFAULT_POST_AUTH_ROUTE,
  ssoEnabled,
  disabled,
}: SocialLoginButtonsProps) {
  const [loadingProvider, setLoadingProvider] = useState<SocialSignInProvider | null>(null)

  const [error, setError] = useState<string | null>(null)

  const available: Record<SocialSignInProvider, boolean> = {
    github: githubAvailable,
    google: googleAvailable,
    microsoft: microsoftAvailable,
  }

  async function signIn(provider: SocialSignInProvider, label: string) {
    if (loadingProvider || disabled) return
    setError(null)
    setLoadingProvider(provider)
    try {
      const result = await startSocialSignIn({
        provider,
        view,
        surface: 'auth_page',
        callbackURL,
      })
      if (result.error) {
        throw new Error(
          result.error.message || `Could not start ${label} sign-in. Please try again.`
        )
      }
    } catch (err) {
      logger.error(`${label} sign-in failed`, { error: getErrorMessage(err) })
      setError(getErrorMessage(err, `Could not start ${label} sign-in. Please try again.`))
    } finally {
      setLoadingProvider(null)
    }
  }

  if (!githubAvailable && !googleAvailable && !microsoftAvailable && !ssoEnabled) {
    return null
  }

  return (
    <AuthStack gap='actions'>
      <AuthProviderGroup>
        {PROVIDERS.filter(({ provider }) => available[provider]).map(
          ({ provider, label, icon }) => (
            <Chip
              key={provider}
              fullWidth
              leftIcon={icon}
              disabled={disabled || loadingProvider !== null}
              onClick={() => signIn(provider, label)}
            >
              {loadingProvider === provider ? 'Connecting…' : label}
            </Chip>
          )
        )}
        {ssoEnabled && (
          <SSOLoginButton
            callbackURL={callbackURL}
            disabled={disabled || loadingProvider !== null}
          />
        )}
      </AuthProviderGroup>
      {error && <AuthFormMessage type='error'>{error}</AuthFormMessage>}
    </AuthStack>
  )
}
