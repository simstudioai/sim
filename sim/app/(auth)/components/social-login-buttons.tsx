'use client'

import { useState } from 'react'
import { GithubIcon, GoogleIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { client } from '@/lib/auth-client'
import { useNotificationStore } from '@/stores/notifications/store'

interface SocialLoginButtonsProps {
  githubAvailable: boolean
  googleAvailable: boolean
  callbackURL?: string
  isProduction: boolean
}

export function SocialLoginButtons({
  githubAvailable,
  googleAvailable,
  callbackURL = '/w',
  isProduction,
}: SocialLoginButtonsProps) {
  const [isGithubLoading, setIsGithubLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const { addNotification } = useNotificationStore()

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

      addNotification('error', errorMessage, null)
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

      addNotification('error', errorMessage, null)
    } finally {
      setIsGoogleLoading(false)
    }
  }

  const githubButton = (
    <Button
      variant="outline"
      className="w-full"
      disabled={!githubAvailable || isGithubLoading}
      onClick={signInWithGithub}
    >
      <GithubIcon className="mr-2 h-4 w-4" />
      {isGithubLoading ? 'Connecting...' : 'Continue with GitHub'}
    </Button>
  )

  const googleButton = (
    <Button
      variant="outline"
      className="w-full"
      disabled={!googleAvailable || isGoogleLoading}
      onClick={signInWithGoogle}
    >
      <GoogleIcon className="mr-2 h-4 w-4" />
      {isGoogleLoading ? 'Connecting...' : 'Continue with Google'}
    </Button>
  )

  const renderGithubButton = () => {
    if (githubAvailable) return githubButton

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div>{githubButton}</div>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              GitHub login requires OAuth credentials to be configured. Add the following
              environment variables:
            </p>
            <ul className="mt-2 text-xs space-y-1">
              <li>• GITHUB_CLIENT_ID</li>
              <li>• GITHUB_CLIENT_SECRET</li>
            </ul>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  const renderGoogleButton = () => {
    if (googleAvailable) return googleButton

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div>{googleButton}</div>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              Google login requires OAuth credentials to be configured. Add the following
              environment variables:
            </p>
            <ul className="mt-2 text-xs space-y-1">
              <li>• GOOGLE_CLIENT_ID</li>
              <li>• GOOGLE_CLIENT_SECRET</li>
            </ul>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <div className="grid gap-2">
      {renderGithubButton()}
      {renderGoogleButton()}
    </div>
  )
}
