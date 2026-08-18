'use client'

import { OPEN_CONSENT_PREFERENCES_EVENT } from '@/lib/consent/constants'
import { PROSE_TYPE } from '@/app/(landing)/components/prose-page/constants'

/**
 * Inline control that reopens the consent banner with its category switches
 * expanded, so a recorded choice can be withdrawn or changed. Wearing the
 * prose link chrome, it reads as part of the sentence it sits in.
 *
 * On a self-hosted deployment the consent runtime is never mounted, so nothing
 * listens and the control is inert — but it is also unreachable, since the
 * Cookie Policy documents Sim's own hosted service.
 */
export function ConsentPreferencesLink({ children }: { children: React.ReactNode }) {
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
