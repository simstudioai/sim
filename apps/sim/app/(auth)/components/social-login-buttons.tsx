'use client'

import { useState } from 'react'
import { AuthFormMessage, AuthProviderGroup, AuthButton as Chip } from '@sim/auth-ui'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { GithubIcon, GoogleIcon, MicrosoftIcon } from '@/components/icons'
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
      await startSocialSignIn({ provider, view, surface: 'auth_page', callbackURL })
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
    <div className='au:space-y-2'>
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
    </div>
  )
}
