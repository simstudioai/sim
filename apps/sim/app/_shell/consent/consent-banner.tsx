'use client'

import { useHeadlessConsentUI } from '@c15t/nextjs/headless'
import { Chip } from '@sim/emcn'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import Link from 'next/link'
import { CONSENT_LINK_CLASS, ConsentPreferences } from '@/app/_shell/consent/consent-preferences'

/** Shared expo-out easing and timings, matching the toast stack's motion. */
const EASE = [0.22, 1, 0.36, 1] as const
const ENTER_TRANSITION = { duration: 0.28, ease: EASE } as const
const EXPAND_TRANSITION = { duration: 0.22, ease: EASE } as const

const CATEGORIES_COLLAPSED = { height: 0, opacity: 0 } as const
const CATEGORIES_OPEN = { height: 'auto', opacity: 1 } as const

/**
 * Cookie consent banner — a non-modal card docked bottom-left, opposite the
 * toast stack and wearing the same chrome. It never dims, blocks, or reflows
 * the page, and "Customize" expands this same card into the per-category
 * switches rather than opening a dialog over the app.
 *
 * Visibility and the available actions come from the jurisdiction policy the
 * consent runtime resolves, so the banner is absent entirely where no consent
 * is required and never offers an action the policy does not allow. Accept and
 * reject carry identical weight, which GDPR requires.
 *
 * It follows the visitor's theme. Every surface it can appear on either pins
 * the light layer on `<html>` through `ThemeProvider`'s forced theme, or is a
 * themed app page where inheriting is what should happen — the card no longer
 * decides for itself.
 */
export function ConsentBanner() {
  const { banner, dialog, openDialog, performAction, saveCustomPreferences } =
    useHeadlessConsentUI()
  const prefersReducedMotion = useReducedMotion()

  const isExpanded = dialog.isVisible
  const surfaceName = isExpanded ? 'dialog' : 'banner'
  const { allowedActions } = isExpanded ? dialog : banner
  const enterOffset = prefersReducedMotion ? 0 : 8

  return (
    <AnimatePresence>
      {(banner.isVisible || dialog.isVisible) && (
        <motion.section
          aria-label='Cookie preferences'
          initial={{ opacity: 0, y: enterOffset }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: enterOffset }}
          transition={ENTER_TRANSITION}
          className='fixed bottom-4 left-4 z-[var(--z-toast)] flex w-[min(100vw-2rem,380px)] flex-col gap-3 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 shadow-overlay'
        >
          <div className='flex flex-col gap-1'>
            <p className='text-[var(--text-body)] text-sm leading-5'>Cookies</p>
            <p className='text-[var(--text-muted)] text-small leading-[18px]'>
              Necessary cookies keep Sim working. Optional cookies help us understand usage, measure
              campaigns, and personalize ads on other sites. You can change or withdraw consent at
              any time in Privacy settings or through our{' '}
              <Link href='/cookie-policy' className={CONSENT_LINK_CLASS}>
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
                <ConsentPreferences />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Two clusters, not `mr-auto` on the chip: chips carry no outer margin. */}
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
                  onClick={() => void performAction('reject', { surface: surfaceName })}
                >
                  Reject all
                </Chip>
              )}
              {allowedActions.includes('accept') && (
                <Chip
                  variant='border'
                  onClick={() => void performAction('accept', { surface: surfaceName })}
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
