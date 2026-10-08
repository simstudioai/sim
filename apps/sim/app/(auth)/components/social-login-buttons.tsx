'use client'

import { type ReactNode, useState } from 'react'
import { Chip, cn } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { GithubIcon, GoogleIcon, MicrosoftIcon } from '@/components/icons'
import { type SocialSignInProvider, startSocialSignIn } from '@/lib/auth/social-sign-in'
import { DEFAULT_POST_AUTH_ROUTE } from '@/app/(auth)/auth-redirect'
import { AUTH_BUTTON_CLASS } from '@/app/(auth)/components/constants'

const logger = createLogger('SocialLoginButtons')

interface SocialLoginButtonsProps {
  githubAvailable: boolean
  googleAvailable: boolean
  microsoftAvailable: boolean
  view: 'login' | 'signup'
  callbackURL?: string
  children?: ReactNode
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
  children,
}: SocialLoginButtonsProps) {
  const [loadingProvider, setLoadingProvider] = useState<SocialSignInProvider | null>(null)

  const available: Record<SocialSignInProvider, boolean> = {
    github: githubAvailable,
    google: googleAvailable,
    microsoft: microsoftAvailable,
  }

  async function signIn(provider: SocialSignInProvider, label: string) {
    setLoadingProvider(provider)
    try {
      await startSocialSignIn({ provider, view, surface: 'auth_page', callbackURL })
    } catch (err) {
      logger.error(`${label} sign-in failed`, { error: getErrorMessage(err) })
    } finally {
      setLoadingProvider(null)
    }
  }

  if (!githubAvailable && !googleAvailable && !microsoftAvailable && !children) {
    return null
  }

  return (
    <div className='grid gap-3'>
      {PROVIDERS.filter(({ provider }) => available[provider]).map(({ provider, label, icon }) => (
        <Chip
          key={provider}
          fullWidth
          leftIcon={icon}
          className={cn(AUTH_BUTTON_CLASS, 'border border-[var(--border)]')}
          disabled={loadingProvider === provider}
          onClick={() => signIn(provider, label)}
        >
          {loadingProvider === provider ? 'Connecting…' : label}
        </Chip>
      ))}
      {children}
    </div>
  )
}
