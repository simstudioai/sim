'use client'

import { useConsentManager, useHeadlessConsentUI } from '@c15t/nextjs/headless'
import { Chip, Label, Switch } from '@sim/emcn'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import Link from 'next/link'
import {
  CONSENT_CATEGORY_COPY,
  CONSENT_CATEGORY_SET,
  type ConsentCategory,
} from '@/app/_shell/consent/constants'

/** Card width; mirrors the toast stack so both floating surfaces read as one system. */
const CARD_WIDTH = 'min(100vw - 2rem, 380px)'

const EASE = [0.22, 1, 0.36, 1] as const
const ENTER_DURATION = 0.28
const EXPAND_DURATION = 0.22

/**
 * Cookie consent banner — a non-modal card docked bottom-left, opposite the
 * toast stack. It never dims or blocks the page, and "Customize" expands this
 * same card into per-category switches rather than opening a dialog over the
 * app.
 *
 * Visibility and the available actions come from the jurisdiction policy the
 * consent runtime resolves, so the banner is absent entirely where no consent
 * is required and never offers an action the policy does not allow. Accept and
 * reject are rendered with identical weight, which GDPR requires.
 */
export function ConsentBanner() {
  const { consents, selectedConsents, setSelectedConsent, consentTypes } = useConsentManager()
  const { banner, dialog, openDialog, performAction, saveCustomPreferences } =
    useHeadlessConsentUI()
  const prefersReducedMotion = useReducedMotion()

  const isExpanded = dialog.isVisible
  const surface = isExpanded ? dialog : banner
  const allowedActions = surface.allowedActions
  const categories = consentTypes.filter(
    (type) => type.display && CONSENT_CATEGORY_SET.has(type.name)
  )

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
          className='fixed bottom-4 left-4 z-40 flex flex-col gap-3 overflow-hidden rounded-xl border border-[var(--border-1)] bg-[var(--bg)] p-4 shadow-[var(--shadow-overlay)]'
        >
          <div className='flex flex-col gap-1'>
            <p className='font-medium text-[13px] text-[var(--text-body)]'>Cookies</p>
            <p className='text-[13px] text-[var(--text-secondary)] leading-normal'>
              We use cookies to run Sim, understand how it is used, and improve it. See our{' '}
              <Link
                href='/privacy'
                className='underline underline-offset-2 hover-hover:text-[var(--text-body)]'
              >
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
                        <div className='flex min-w-0 flex-col gap-0.5'>
                          <Label htmlFor={inputId}>{copy?.title ?? type.name}</Label>
                          <p className='text-[12px] text-[var(--text-muted)] leading-normal'>
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
