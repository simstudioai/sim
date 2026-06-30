'use client'

import { type ReactNode, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { Chip } from '@/components/emcn'
import { GithubIcon, GoogleIcon, MicrosoftIcon } from '@/components/icons'
import { client } from '@/lib/auth/auth-client'
import { cn } from '@/lib/core/utils/cn'
import { AUTH_BUTTON_CLASS } from '@/app/(auth)/components/constants'

const logger = createLogger('SocialLoginButtons')

interface SocialLoginButtonsProps {
  githubAvailable: boolean
  googleAvailable: boolean
  microsoftAvailable: boolean
  callbackURL?: string
  isProduction: boolean
  children?: ReactNode
}

export function SocialLoginButtons({
  githubAvailable,
  googleAvailable,
  microsoftAvailable,
  callbackURL = '/workspace',
  isProduction,
  children,
}: SocialLoginButtonsProps) {
  const [isGithubLoading, setIsGithubLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const [isMicrosoftLoading, setIsMicrosoftLoading] = useState(false)

  async function signInWithGithub() {
    if (!githubAvailable) return

    setIsGithubLoading(true)
    try {
      await client.signIn.social({ provider: 'github', callbackURL })
    } catch (err) {
      logger.error('GitHub sign-in failed', { error: getErrorMessage(err) })
    } finally {
      setIsGithubLoading(false)
    }
  }

  async function signInWithGoogle() {
    if (!googleAvailable) return

    setIsGoogleLoading(true)
    try {
      await client.signIn.social({ provider: 'google', callbackURL })
    } catch (err) {
      logger.error('Google sign-in failed', { error: getErrorMessage(err) })
    } finally {
      setIsGoogleLoading(false)
    }
  }

  async function signInWithMicrosoft() {
    if (!microsoftAvailable) return

    setIsMicrosoftLoading(true)
    try {
      await client.signIn.social({ provider: 'microsoft', callbackURL })
    } catch (err) {
      logger.error('Microsoft sign-in failed', { error: getErrorMessage(err) })
    } finally {
      setIsMicrosoftLoading(false)
    }
  }

  const githubButton = (
    <Chip
      fullWidth
      flush
      leftIcon={GithubIcon}
      className={cn(AUTH_BUTTON_CLASS, 'border border-[var(--border-1)]')}
      disabled={!githubAvailable || isGithubLoading}
      onClick={signInWithGithub}
    >
      {isGithubLoading ? 'Connecting…' : 'GitHub'}
    </Chip>
  )

  const googleButton = (
    <Chip
      fullWidth
      flush
      leftIcon={GoogleIcon}
      className={cn(AUTH_BUTTON_CLASS, 'border border-[var(--border-1)]')}
      disabled={!googleAvailable || isGoogleLoading}
      onClick={signInWithGoogle}
    >
      {isGoogleLoading ? 'Connecting…' : 'Google'}
    </Chip>
  )

  const microsoftButton = (
    <Chip
      fullWidth
      flush
      leftIcon={MicrosoftIcon}
      className={cn(AUTH_BUTTON_CLASS, 'border border-[var(--border-1)]')}
      disabled={!microsoftAvailable || isMicrosoftLoading}
      onClick={signInWithMicrosoft}
    >
      {isMicrosoftLoading ? 'Connecting…' : 'Microsoft'}
    </Chip>
  )

  const hasAnyOAuthProvider = githubAvailable || googleAvailable || microsoftAvailable

  if (!hasAnyOAuthProvider && !children) {
    return null
  }

  return (
    <div className='grid gap-3'>
      {googleAvailable && googleButton}
      {microsoftAvailable && microsoftButton}
      {githubAvailable && githubButton}
      {children}
    </div>
  )
}
