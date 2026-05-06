'use client'

import { useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { X } from 'lucide-react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
  Loader,
  Modal,
  ModalClose,
  ModalContent,
  ModalTitle,
  ModalTrigger,
} from '@/components/emcn'
import { GithubIcon, GoogleIcon } from '@/components/icons'
import { requestJson } from '@/lib/api/client/request'
import { type AuthProviderStatusResponse, getAuthProvidersContract } from '@/lib/api/contracts/auth'
import { client } from '@/lib/auth/auth-client'
import { getEnv, isFalsy, isTruthy } from '@/lib/core/config/env'
import { captureClientEvent } from '@/lib/posthog/client'
import type { PostHogEventMap } from '@/lib/posthog/events'
import { getBrandConfig } from '@/ee/whitelabeling'

const logger = createLogger('AuthModal')

type AuthView = 'login' | 'signup'

interface AuthModalProps {
  children: React.ReactNode
  defaultView?: AuthView
  source: PostHogEventMap['auth_modal_opened']['source']
}

type ProviderStatus = AuthProviderStatusResponse

let fetchPromise: Promise<AuthProviderStatusResponse> | null = null

const FALLBACK_STATUS: ProviderStatus = {
  githubAvailable: false,
  googleAvailable: false,
  registrationDisabled: false,
}

const SOCIAL_BTN =
  'relative flex h-[32px] w-full items-center justify-center rounded-[5px] border border-[var(--landing-border-strong)] text-[13.5px] text-[var(--landing-text)] transition-colors hover:bg-[var(--landing-bg-elevated)] disabled:cursor-not-allowed disabled:opacity-50'

function fetchProviderStatus(): Promise<ProviderStatus> {
  if (fetchPromise) return fetchPromise
  fetchPromise = requestJson(getAuthProvidersContract, {})
    .then(({ githubAvailable, googleAvailable, registrationDisabled }) => ({
      githubAvailable,
      googleAvailable,
      registrationDisabled,
    }))
    .catch(() => {
      fetchPromise = null
      return FALLBACK_STATUS
    })
  return fetchPromise
}

export function AuthModal({ children, defaultView = 'login', source }: AuthModalProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<AuthView>(defaultView)
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null)
  const [socialLoading, setSocialLoading] = useState<'github' | 'google' | null>(null)
  const brand = useMemo(() => getBrandConfig(), [])

  useEffect(() => {
    fetchProviderStatus().then(setProviderStatus)
  }, [])

  const hasSocial = providerStatus?.githubAvailable || providerStatus?.googleAvailable
  const ssoEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))
  const emailEnabled = !isFalsy(getEnv('NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED'))
  const hasModalContent = hasSocial || ssoEnabled

  useEffect(() => {
    if (!open || !providerStatus) return
    if (!hasModalContent) {
      setOpen(false)
      router.push(defaultView === 'login' ? '/login' : '/signup')
      return
    }
    if (providerStatus.registrationDisabled && view === 'signup') {
      setView('login')
    }
  }, [open, providerStatus, hasModalContent, defaultView, router, view])

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen && providerStatus && !hasModalContent) {
      router.push(defaultView === 'login' ? '/login' : '/signup')
      return
    }
    setOpen(nextOpen)
    if (nextOpen) {
      const initialView =
        defaultView === 'signup' && providerStatus?.registrationDisabled ? 'login' : defaultView
      setView(initialView)
      captureClientEvent('auth_modal_opened', { view: initialView, source })
    }
  }

  async function handleSocialLogin(provider: 'github' | 'google') {
    setSocialLoading(provider)
    try {
      await client.signIn.social({ provider, callbackURL: '/workspace' })
    } catch (error) {
      logger.warn('Social sign-in did not complete', { provider, error })
    } finally {
      setSocialLoading(null)
    }
  }

  function handleSSOLogin() {
    setOpen(false)
    router.push('/sso')
  }

  function handleEmailContinue() {
    setOpen(false)
    router.push(view === 'login' ? '/login' : '/signup')
  }

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalTrigger asChild>{children}</ModalTrigger>
      <ModalContent
        size='sm'
        className='dark bg-[var(--landing-bg)] font-[430] font-season text-[var(--landing-text)]'
      >
        <ModalTitle className='sr-only'>
          {view === 'login' ? 'Log in' : 'Create account'}
        </ModalTitle>

        <div className='relative px-6 pt-6 pb-6'>
          <ModalClose className='absolute top-6 right-6 rounded-sm opacity-70 transition-opacity hover:opacity-100'>
            <X className='h-5 w-5 text-[var(--landing-text-muted)]' />
            <span className='sr-only'>Close</span>
          </ModalClose>

          {!providerStatus ? (
            <div className='flex items-center justify-center py-16'>
              <Loader className='h-5 w-5 text-[var(--landing-text-muted)]' animate />
            </div>
          ) : (
            <>
              <div className='flex flex-col items-start gap-6 pe-10'>
                <Image
                  src={brand.logoUrl || '/logo/sim-landing.svg'}
                  alt={brand.name}
                  width={71}
                  height={22}
                  unoptimized
                  className='h-[22px] w-auto shrink-0 object-contain'
                />
                <div className='flex flex-col gap-1 text-left'>
                  <p className='text-[22px] text-[color-mix(in_srgb,var(--landing-text-subtle)_60%,transparent)] leading-[125%] tracking-[0.02em]'>
                    Start building.
                  </p>
                  <h2 className='text-[22px] text-white leading-[110%] tracking-[-0.02em]'>
                    {view === 'login' ? 'Log in to continue' : 'Create free account'}
                  </h2>
                </div>
              </div>

              <div className='mt-6 space-y-3'>
                {providerStatus.googleAvailable && (
                  <button
                    type='button'
                    onClick={() => handleSocialLogin('google')}
                    disabled={!!socialLoading}
                    className={SOCIAL_BTN}
                  >
                    <GoogleIcon className='absolute left-4 h-[18px] w-[18px] shrink-0' />
                    <span>
                      {socialLoading === 'google' ? 'Connecting...' : 'Continue with Google'}
                    </span>
                  </button>
                )}
                {providerStatus.githubAvailable && (
                  <button
                    type='button'
                    onClick={() => handleSocialLogin('github')}
                    disabled={!!socialLoading}
                    className={SOCIAL_BTN}
                  >
                    <GithubIcon className='absolute left-4 h-[18px] w-[18px] shrink-0' />
                    <span>
                      {socialLoading === 'github' ? 'Connecting...' : 'Continue with GitHub'}
                    </span>
                  </button>
                )}
                {ssoEnabled && (
                  <button type='button' onClick={handleSSOLogin} className={SOCIAL_BTN}>
                    Sign in with SSO
                  </button>
                )}
              </div>

              {emailEnabled && (
                <>
                  <div className='relative my-4'>
                    <div className='absolute inset-0 flex items-center'>
                      <div className='w-full border-[var(--landing-bg-elevated)] border-t' />
                    </div>
                    <div className='relative flex justify-center text-[13.5px]'>
                      <span className='bg-[var(--landing-bg)] px-4 text-[var(--landing-text-muted)]'>
                        Or
                      </span>
                    </div>
                  </div>

                  <button
                    type='button'
                    onClick={handleEmailContinue}
                    className='flex h-[32px] w-full items-center justify-center rounded-[5px] border border-[var(--auth-primary-btn-border)] bg-[var(--auth-primary-btn-bg)] text-[13.5px] text-[var(--auth-primary-btn-text)] transition-colors hover:border-[var(--auth-primary-btn-hover-border)] hover:bg-[var(--auth-primary-btn-hover-bg)]'
                  >
                    Continue with email
                  </button>
                </>
              )}

              <div className='mt-4 text-center text-[13.5px]'>
                <span className='text-[var(--landing-text-muted)]'>
                  {view === 'login' ? "Don't have an account? " : 'Already have an account? '}
                </span>
                {view === 'login' && providerStatus.registrationDisabled ? (
                  <span className='text-[var(--landing-text-muted)]'>Registration is disabled</span>
                ) : (
                  <button
                    type='button'
                    onClick={() => setView(view === 'login' ? 'signup' : 'login')}
                    className='text-[var(--landing-text)] underline-offset-4 transition hover:text-white hover:underline'
                  >
                    {view === 'login' ? 'Sign up' : 'Sign in'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </ModalContent>
    </Modal>
  )
}
