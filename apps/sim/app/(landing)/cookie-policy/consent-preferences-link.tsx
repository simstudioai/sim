'use client'

import type { ReactNode } from 'react'
import { ConsentPreferencesTrigger } from '@/app/_shell/consent/consent-preferences-trigger'
import { PROSE_TYPE } from '@/app/(landing)/components/prose-page/constants'

interface ConsentPreferencesLinkProps {
  children: ReactNode
}

/**
 * Inline control that reopens the consent banner with its category switches
 * expanded, so a recorded choice can be withdrawn or changed. Wearing the
 * prose link chrome, it reads as part of the sentence it sits in.
 *
 * Only rendered where the consent runtime is mounted — see the call site. The
 * Cookie Policy renders plain text on self-hosted deployments, where there is
 * no preferences dialog to open.
 */
export function ConsentPreferencesLink({ children }: ConsentPreferencesLinkProps) {
  return (
    <ConsentPreferencesTrigger className={PROSE_TYPE.link}>{children}</ConsentPreferencesTrigger>
  )
}
