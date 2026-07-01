'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Loader,
  Modal,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalTitle,
  ModalTrigger,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { X } from 'lucide-react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { GithubIcon, GoogleIcon, MicrosoftIcon } from '@/components/icons'
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
  microsoftAvailable: false,
  registrationDisabled: false,
}

const SOCIAL_BTN =
  'relative flex h-[32px] w-full items-center justify-center rounded-[5px] border border-[var(--border-1)] text-[13.5px] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50'

function fetchProviderStatus(): Promise<ProviderStatus> {
  if (fetchPromise) return fetchPromise
  fetchPromise = requestJson(getAuthProvidersContract, {})
    .then(({ githubAvailable, googleAvailable, microsoftAvailable, registrationDisabled }) => ({
      githubAvailable,
      googleAvailable,
      microsoftAvailable,
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
  const [socialLoading, setSocialLoading] = useState<'github' | 'google' | 'microsoft' | null>(null)
  const brand = getBrandConfig()

  useEffect(() => {
    fetchProviderStatus().then(setProviderStatus)
  }, [])

  const ssoEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))
  const emailEnabled = !isFalsy(getEnv('NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED'))

  /**
   * Signup is unavailable when registration is disabled, so the shown view is
   * clamped to login rather than mirrored into state through an effect.
   */
  const effectiveView: AuthView =
    view === 'signup' && providerStatus?.registrationDisabled ? 'login' : view

  /**
   * Tracks whether the visitor still wants the modal open. Cleared on dismiss so a
   * provider-status fetch that resolves afterwards can't reopen it or re-fire the
   * opened event.
   */
  const openRequestedRef = useRef(false)

  function openWithStatus(status: ProviderStatus) {
    const hasModalContent =
      status.githubAvailable || status.googleAvailable || status.microsoftAvailable || ssoEnabled
    if (!hasModalContent) {
      /** Close the loader (no-op if never opened) and route out; disabled registration sends signup to login. */
      setOpen(false)
      router.push(status.registrationDisabled || defaultView === 'login' ? '/login' : '/signup')
      return
    }
    const initialView: AuthView =
      defaultView === 'signup' && status.registrationDisabled ? 'login' : defaultView
    setOpen(true)
    setView(initialView)
    captureClientEvent('auth_modal_opened', { view: initialView, source })
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      openRequestedRef.current = false
      setOpen(false)
      return
    }
    if (providerStatus) {
      openWithStatus(providerStatus)
      return
    }
    /** Status not loaded yet: open the loader immediately for responsiveness, then resolve. */
    openRequestedRef.current = true
    setOpen(true)
    fetchProviderStatus().then((status) => {
      setProviderStatus(status)
      if (!openRequestedRef.current) return
      /** Consume the request so a queued double-click can't open twice (no duplicate event). */
      openRequestedRef.current = false
      openWithStatus(status)
    })
  }

  async function handleSocialLogin(provider: 'github' | 'google' | 'microsoft') {
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
    router.push(effectiveView === 'login' ? '/login' : '/signup')
  }

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalTrigger asChild>{children}</ModalTrigger>
      <ModalContent size='sm' className='dark bg-[var(--bg)] text-[var(--text-primary)]'>
        <ModalTitle className='sr-only'>
          {effectiveView === 'login' ? 'Log in' : 'Create account'}
        </ModalTitle>
        <ModalDescription className='sr-only'>
          {effectiveView === 'login' ? 'Sign in to your account' : 'Create a new account'}
        </ModalDescription>

        <div className='relative px-6 pt-6 pb-6'>
          <ModalClose className='absolute top-6 right-6 rounded-sm opacity-70 transition-opacity hover:opacity-100'>
            <X className='size-5 text-[var(--text-muted)]' />
            <span className='sr-only'>Close</span>
          </ModalClose>

          {!providerStatus ? (
            <div className='flex items-center justify-center py-16'>
              <Loader className='size-5 text-[var(--text-muted)]' animate />
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
                  <p className='text-[22px] text-[color-mix(in_srgb,var(--text-muted)_60%,transparent)] leading-[125%] tracking-[0.02em]'>
                    Start building.
                  </p>
                  <h2 className='text-[22px] text-[var(--text-primary)] leading-[110%] tracking-[-0.02em]'>
                    {effectiveView === 'login' ? 'Log in to continue' : 'Create free account'}
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
                    <GoogleIcon className='absolute left-4 size-[18px] shrink-0' />
                    <span>
                      {socialLoading === 'google' ? 'Connecting...' : 'Continue with Google'}
                    </span>
                  </button>
                )}
                {providerStatus.microsoftAvailable && (
                  <button
                    type='button'
                    onClick={() => handleSocialLogin('microsoft')}
                    disabled={!!socialLoading}
                    className={SOCIAL_BTN}
                  >
                    <MicrosoftIcon className='absolute left-4 size-[18px] shrink-0' />
                    <span>
                      {socialLoading === 'microsoft' ? 'Connecting...' : 'Continue with Microsoft'}
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
                    <GithubIcon className='absolute left-4 size-[18px] shrink-0' />
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
                      <div className='w-full border-[var(--border)] border-t' />
                    </div>
                    <div className='relative flex justify-center text-[13.5px]'>
                      <span className='bg-[var(--bg)] px-4 text-[var(--text-muted)]'>Or</span>
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
                <span className='text-[var(--text-muted)]'>
                  {effectiveView === 'login'
                    ? "Don't have an account? "
                    : 'Already have an account? '}
                </span>
                {effectiveView === 'login' && providerStatus.registrationDisabled ? (
                  <span className='text-[var(--text-muted)]'>Registration is disabled</span>
                ) : (
                  <button
                    type='button'
                    onClick={() => setView(effectiveView === 'login' ? 'signup' : 'login')}
                    className='text-[var(--text-primary)] underline-offset-4 transition hover:text-[var(--text-primary)] hover:underline'
                  >
                    {effectiveView === 'login' ? 'Sign up' : 'Sign in'}
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
