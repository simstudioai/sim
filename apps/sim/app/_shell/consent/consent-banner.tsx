'use client'

import { useEffect } from 'react'
import { useConsentManager, useHeadlessConsentUI } from '@c15t/nextjs/headless'
import { Chip, Label, Switch } from '@sim/emcn'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import Link from 'next/link'
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

/** Sized against the toast stack so both floating surfaces read as one system. */
const CARD_STYLE = { width: 'min(100vw - 2rem, 380px)' } as const

/** Shared expo-out easing, matching the toast stack's motion. */
const EASE = [0.22, 1, 0.36, 1] as const
const ENTER_TRANSITION = { duration: 0.28, ease: EASE } as const
const EXPAND_TRANSITION = { duration: 0.22, ease: EASE } as const

const CARD_HIDDEN = { opacity: 0, y: 8 } as const
const CARD_SHOWN = { opacity: 1, y: 0 } as const
const CARD_HIDDEN_REDUCED = { opacity: 0 } as const
const CARD_SHOWN_REDUCED = { opacity: 1 } as const

const CATEGORIES_COLLAPSED = { height: 0, opacity: 0 } as const
const CATEGORIES_OPEN = { height: 'auto', opacity: 1 } as const

/** Inline link chrome, matching `PROSE_TYPE.link` on the legal pages. */
const LINK_CLASS =
  'text-[var(--text-primary)] underline underline-offset-2 transition-colors hover:text-[var(--text-body)]'

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
 *
 * The card pins the `light` token layer rather than following the visitor's
 * theme, as every other public surface does (`LandingShell`, `AuthShell`, the
 * chat interfaces, the public file view). Consent is asked for on a first
 * visit, which always lands on one of those; reaching the themed app without a
 * consent record takes an expiry against a live session.
 */
export function ConsentBanner() {
  const { consents, selectedConsents, setSelectedConsent, getDisplayedConsents } =
    useConsentManager()
  const { banner, dialog, openDialog, performAction, saveCustomPreferences } =
    useHeadlessConsentUI()
  const prefersReducedMotion = useReducedMotion()

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
          initial={prefersReducedMotion ? CARD_HIDDEN_REDUCED : CARD_HIDDEN}
          animate={prefersReducedMotion ? CARD_SHOWN_REDUCED : CARD_SHOWN}
          exit={prefersReducedMotion ? CARD_HIDDEN_REDUCED : CARD_HIDDEN}
          transition={ENTER_TRANSITION}
          style={CARD_STYLE}
          className='light fixed bottom-4 left-4 z-[var(--z-toast)] flex flex-col gap-3 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 shadow-overlay'
        >
          <div className='flex flex-col gap-1'>
            <p className='text-[var(--text-body)] text-sm leading-5'>Cookies</p>
            <p className='text-[var(--text-muted)] text-small leading-[18px]'>
              We use cookies to run Sim, understand how it is used, and improve it. Read our{' '}
              <Link href='/cookie-policy' className={LINK_CLASS}>
                Cookie Policy
              </Link>
              .
            </p>
          </div>

          <AnimatePresence initial={false}>
            {isExpanded && (
              <motion.div
                key='categories'
                initial={CATEGORIES_COLLAPSED}
                animate={CATEGORIES_OPEN}
                exit={CATEGORIES_COLLAPSED}
                transition={EXPAND_TRANSITION}
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

          <div className='flex items-center justify-between gap-1'>
            <div className='flex items-center gap-1'>
              {!isExpanded && allowedActions.includes('customize') && (
                <Chip onClick={openDialog}>Customize</Chip>
              )}
            </div>
            <div className='flex items-center gap-1'>
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
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  )
}
