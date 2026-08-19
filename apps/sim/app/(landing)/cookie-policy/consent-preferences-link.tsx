'use client'

import type { ReactNode } from 'react'
import { OPEN_CONSENT_PREFERENCES_EVENT } from '@/lib/consent/constants'
import { PROSE_TYPE } from '@/app/(landing)/components/prose-page/constants'

interface ConsentPreferencesLinkProps {
  children: ReactNode
}

/**
 * Inline control that reopens the consent banner with its category switches
 * expanded, so a recorded choice can be withdrawn or changed. Wearing the
 * prose link chrome, it reads as part of the sentence it sits in.
 *
 * Only rendered where the consent runtime is mounted — see the call site. On a
 * self-hosted deployment nothing would listen for the event, so the Cookie
 * Policy renders the phrase as plain text rather than a control that does
 * nothing when clicked.
 */
export function ConsentPreferencesLink({ children }: ConsentPreferencesLinkProps) {
  return (
    <button
      type='button'
      className={PROSE_TYPE.link}
      onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_PREFERENCES_EVENT))}
    >
      {children}
    </button>
  )
}
