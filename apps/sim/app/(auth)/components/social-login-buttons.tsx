'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { GithubIcon, GoogleIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { client } from '@/lib/auth/auth-client'
import { inter } from '@/app/_styles/fonts/inter/inter'
import { useTranslations } from 'next-intl'

interface SocialLoginButtonsProps {
  githubAvailable: boolean
  googleAvailable: boolean
  callbackURL?: string
  isProduction: boolean
  children?: ReactNode
}

export function SocialLoginButtons({
  githubAvailable,
  googleAvailable,
  callbackURL = '/workspace',
  isProduction,
  children,
}: SocialLoginButtonsProps) {
  const t = useTranslations('social_login')

  const [isGithubLoading, setIsGithubLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  async function signInWithGithub() {
    if (!githubAvailable) return

    setIsGithubLoading(true)
    try {
      await client.signIn.social({ provider: 'github', callbackURL })
    } catch (err: any) {
      let errorMessage = t('errors.github.default')

      if (err.message?.includes('account exists')) {
        errorMessage = t('errors.account_exists')
      } else if (err.message?.includes('cancelled')) {
        errorMessage = t('errors.github.cancelled')
      } else if (err.message?.includes('network')) {
        errorMessage = t('errors.network')
      } else if (err.message?.includes('rate limit')) {
        errorMessage = t('errors.rate_limit')
      }

      console.error(errorMessage)
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
      let errorMessage = t('errors.google.default')

      if (err.message?.includes('account exists')) {
        errorMessage = t('errors.account_exists')
      } else if (err.message?.includes('cancelled')) {
        errorMessage = t('errors.google.cancelled')
      } else if (err.message?.includes('network')) {
        errorMessage = t('errors.network')
      } else if (err.message?.includes('rate limit')) {
        errorMessage = t('errors.rate_limit')
      }

      console.error(errorMessage)
    } finally {
      setIsGoogleLoading(false)
    }
  }

  const githubButton = (
    <Button
      variant='outline'
      className='w-full rounded-[10px] shadow-sm hover:bg-gray-50'
      disabled={!githubAvailable || isGithubLoading}
      onClick={signInWithGithub}
    >
      <GithubIcon className='!h-[18px] !w-[18px] mr-1' />
      {isGithubLoading ? t('buttons.connecting') : t('buttons.github')}
    </Button>
  )

  const googleButton = (
    <Button
      variant='outline'
      className='w-full rounded-[10px] shadow-sm hover:bg-gray-50'
      disabled={!googleAvailable || isGoogleLoading}
      onClick={signInWithGoogle}
    >
      <GoogleIcon className='!h-[18px] !w-[18px] mr-1' />
      {isGoogleLoading ? t('buttons.connecting') : t('buttons.google')}
    </Button>
  )

  const hasAnyOAuthProvider = githubAvailable || googleAvailable

  if (!hasAnyOAuthProvider && !children) {
    return null
  }

  return (
    <div className={`${inter.className} grid gap-3 font-light`}>
      {googleAvailable && googleButton}
      {githubAvailable && githubButton}
      {children}
    </div>
  )
}
