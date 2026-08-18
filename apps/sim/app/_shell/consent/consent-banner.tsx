'use client'

import { useEffect, useState } from 'react'
import { useConsentManager, useHeadlessConsentUI } from '@c15t/nextjs/headless'
import { Chip, cn, Label, Switch } from '@sim/emcn'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ConsentCategory, OPEN_CONSENT_PREFERENCES_EVENT } from '@/lib/consent/constants'

interface ConsentCategoryCopy {
  title: string
  description: string
}

/**
 * Sim's own wording per category. The runtime ships generic descriptions; these
 * say what the cookies actually do here. A category without an entry falls back
 * to the runtime's description rather than disappearing.
 */
const CONSENT_CATEGORY_COPY: Partial<Record<ConsentCategory, ConsentCategoryCopy>> = {
  necessary: {
    title: 'Necessary',
    description: 'Sign-in and security. Always on.',
  },
  measurement: {
    title: 'Analytics',
    description: 'Shows us how Sim is used so we can make it better.',
  },
  marketing: {
    title: 'Marketing',
    description: 'Measures which campaigns bring builders to Sim.',
  },
}

/** Card width; sized against the toast stack so both floating surfaces read as one system. */
const CARD_WIDTH = 'min(100vw - 2rem, 380px)'

/** Shared expo-out easing and timings, matching the toast stack's motion. */
const EASE = [0.22, 1, 0.36, 1] as const
const ENTER_DURATION = 0.28
const EXPAND_DURATION = 0.22

/** Inline link chrome, aligned with the auth and legal-prose link treatments. */
const LINK_CLASS =
  'text-[var(--text-secondary)] underline underline-offset-2 transition-colors hover:text-[var(--text-primary)]'

/**
 * Reports whether the current surface pins the light token layer.
 *
 * Public surfaces force light over the visitor's theme — some through
 * `ThemeProvider`'s forced-theme list, which puts `light` on `<html>`, and the
 * rest through a shell wrapper (`LandingShell`, `AuthShell`, the chat
 * interfaces, the public file view). The banner mounts at the root, outside
 * those wrappers, so on a landing route missing from the forced-theme list a
 * dark-theme visitor would get a dark card over a light page. Probing for the
 * layer covers both mechanisms without a route list to keep in sync.
 */
function useLightTokenLayer(): boolean {
  const pathname = usePathname()
  const [isLight, setIsLight] = useState(false)

  useEffect(() => {
    setIsLight(document.querySelector('.light') !== null)
  }, [pathname])

  return isLight
}

/**
 * Cookie consent banner — a non-modal card docked bottom-left, opposite the
 * toast stack and wearing the same chrome. It never dims, blocks, or reflows
 * the page, and "Customize" expands this same card into per-category switches
 * rather than opening a dialog over the app.
 *
 * Visibility and the available actions come from the jurisdiction policy the
 * consent runtime resolves, so the banner is absent entirely where no consent
 * is required and never offers an action the policy does not allow. Accept and
 * reject carry identical weight, which GDPR requires.
 */
export function ConsentBanner() {
  const { consents, selectedConsents, setSelectedConsent, getDisplayedConsents } =
    useConsentManager()
  const { banner, dialog, openDialog, performAction, saveCustomPreferences } =
    useHeadlessConsentUI()
  const prefersReducedMotion = useReducedMotion()
  const isLightSurface = useLightTokenLayer()

  useEffect(() => {
    window.addEventListener(OPEN_CONSENT_PREFERENCES_EVENT, openDialog)
    return () => window.removeEventListener(OPEN_CONSENT_PREFERENCES_EVENT, openDialog)
  }, [openDialog])

  const isExpanded = dialog.isVisible
  const surface = isExpanded ? dialog : banner
  const { allowedActions } = surface
  /**
   * The store's own selector, not a hand-rolled filter over `consentTypes`: the
   * shipped defaults mark every category except `necessary` as `display: false`,
   * so filtering on that flag silently renders a one-row list.
   */
  const categories = getDisplayedConsents()

  return (
    <AnimatePresence>
      {(banner.isVisible || dialog.isVisible) && (
        <motion.section
          aria-label='Cookie preferences'
          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
          transition={{ duration: ENTER_DURATION, ease: EASE }}
          style={{ width: CARD_WIDTH }}
          className={cn(
            isLightSurface && 'light',
            'fixed bottom-4 left-4 z-[var(--z-toast)] flex flex-col gap-3 overflow-hidden rounded-xl border border-[var(--border-1)] bg-[var(--bg)] p-4 shadow-[var(--shadow-overlay)]'
          )}
        >
          <div className='flex flex-col gap-1'>
            <p className='text-[var(--text-body)] text-sm leading-5'>Cookies</p>
            <p className='text-[var(--text-muted)] text-small leading-[18px]'>
              We use cookies to run Sim, understand how it is used, and improve it. Read our{' '}
              <Link href='/privacy' className={LINK_CLASS}>
                Privacy Policy
              </Link>
              .
            </p>
          </div>

          <AnimatePresence initial={false}>
            {isExpanded && (
              <motion.div
                key='categories'
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: EXPAND_DURATION, ease: EASE }}
                className='overflow-hidden'
              >
                <ul className='flex flex-col gap-3'>
                  {categories.map((type) => {
                    const copy = CONSENT_CATEGORY_COPY[type.name as ConsentCategory]
                    const inputId = `consent-${type.name}`
                    return (
                      <li key={type.name} className='flex items-start justify-between gap-3'>
                        <div className='flex min-w-0 flex-col gap-1'>
                          <Label htmlFor={inputId}>{copy?.title ?? type.name}</Label>
                          <p className='text-[var(--text-muted)] text-caption leading-4'>
                            {copy?.description ?? type.description}
                          </p>
                        </div>
                        <Switch
                          id={inputId}
                          checked={selectedConsents[type.name] ?? consents[type.name] ?? false}
                          disabled={type.disabled}
                          onCheckedChange={(checked) => setSelectedConsent(type.name, checked)}
                        />
                      </li>
                    )
                  })}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>

          <div className='flex items-center justify-end gap-1'>
            {!isExpanded && allowedActions.includes('customize') && (
              <Chip className='mr-auto' onClick={openDialog}>
                Customize
              </Chip>
            )}
            {allowedActions.includes('reject') && (
              <Chip
                variant='border'
                onClick={() =>
                  void performAction('reject', { surface: isExpanded ? 'dialog' : 'banner' })
                }
              >
                Reject all
              </Chip>
            )}
            {allowedActions.includes('accept') && (
              <Chip
                variant='border'
                onClick={() =>
                  void performAction('accept', { surface: isExpanded ? 'dialog' : 'banner' })
                }
              >
                Accept all
              </Chip>
            )}
            {isExpanded && (
              <Chip variant='primary' onClick={() => void saveCustomPreferences()}>
                Save
              </Chip>
            )}
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  )
}
