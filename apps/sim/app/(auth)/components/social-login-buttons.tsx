'use client'

import { type ReactNode, useState } from 'react'
import { Button } from '@sim/emcn'
import { GithubIcon, GoogleIcon, MicrosoftIcon } from '@/components/icons'
import { client } from '@/lib/auth/auth-client'

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
    } catch (err: any) {
      let errorMessage = 'Failed to sign in with GitHub'

      if (err.message?.includes('account exists')) {
        errorMessage = 'An account with this email already exists. Please sign in instead.'
      } else if (err.message?.includes('cancelled')) {
        errorMessage = 'GitHub sign in was cancelled. Please try again.'
      } else if (err.message?.includes('network')) {
        errorMessage = 'Network error. Please check your connection and try again.'
      } else if (err.message?.includes('rate limit')) {
        errorMessage = 'Too many attempts. Please try again later.'
      }
    } finally {
      setIsGithubLoading(false)
    }
  }

  async function signInWithGoogle() {
    if (!googleAvailable) return

    setIsGoogleLoading(true)
    try {
      await client.signIn.social({ provider: 'google', callbackURL })
    } catch (err: any) {
      let errorMessage = 'Failed to sign in with Google'

      if (err.message?.includes('account exists')) {
        errorMessage = 'An account with this email already exists. Please sign in instead.'
      } else if (err.message?.includes('cancelled')) {
        errorMessage = 'Google sign in was cancelled. Please try again.'
      } else if (err.message?.includes('network')) {
        errorMessage = 'Network error. Please check your connection and try again.'
      } else if (err.message?.includes('rate limit')) {
        errorMessage = 'Too many attempts. Please try again later.'
      }
    } finally {
      setIsGoogleLoading(false)
    }
  }

  async function signInWithMicrosoft() {
    if (!microsoftAvailable) return

    setIsMicrosoftLoading(true)
    try {
      await client.signIn.social({ provider: 'microsoft', callbackURL })
    } catch (err: any) {
      let errorMessage = 'Failed to sign in with Microsoft'

      if (err.message?.includes('account exists')) {
        errorMessage = 'An account with this email already exists. Please sign in instead.'
      } else if (err.message?.includes('cancelled')) {
        errorMessage = 'Microsoft sign in was cancelled. Please try again.'
      } else if (err.message?.includes('network')) {
        errorMessage = 'Network error. Please check your connection and try again.'
      } else if (err.message?.includes('rate limit')) {
        errorMessage = 'Too many attempts. Please try again later.'
      }
    } finally {
      setIsMicrosoftLoading(false)
    }
  }

  const githubButton = (
    <Button
      variant='outline'
      className='w-full rounded-sm border-[var(--landing-border-strong)] py-1.5 text-sm'
      disabled={!githubAvailable || isGithubLoading}
      onClick={signInWithGithub}
    >
      <GithubIcon className='!h-[18px] !w-[18px] mr-1' />
      {isGithubLoading ? 'Connecting...' : 'GitHub'}
    </Button>
  )

  const googleButton = (
    <Button
      variant='outline'
      className='w-full rounded-sm border-[var(--landing-border-strong)] py-1.5 text-sm'
      disabled={!googleAvailable || isGoogleLoading}
      onClick={signInWithGoogle}
    >
      <GoogleIcon className='!h-[18px] !w-[18px] mr-1' />
      {isGoogleLoading ? 'Connecting...' : 'Google'}
    </Button>
  )

  const microsoftButton = (
    <Button
      variant='outline'
      className='w-full rounded-sm border-[var(--landing-border-strong)] py-1.5 text-sm'
      disabled={!microsoftAvailable || isMicrosoftLoading}
      onClick={signInWithMicrosoft}
    >
      <MicrosoftIcon className='!h-[18px] !w-[18px] mr-1' />
      {isMicrosoftLoading ? 'Connecting...' : 'Microsoft'}
    </Button>
  )

  const hasAnyOAuthProvider = githubAvailable || googleAvailable || microsoftAvailable

  if (!hasAnyOAuthProvider && !children) {
    return null
  }

  return (
    <div className='grid gap-3 font-light'>
      {googleAvailable && googleButton}
      {microsoftAvailable && microsoftButton}
      {githubAvailable && githubButton}
      {children}
    </div>
  )
}
