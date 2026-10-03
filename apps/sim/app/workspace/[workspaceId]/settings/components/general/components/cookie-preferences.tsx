'use client'

import { useState } from 'react'
import { useConsentManager } from '@c15t/nextjs/headless'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import { CONSENT_LINK_CLASS, ConsentPreferences } from '@/app/_shell/consent/consent-preferences'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'

function CookiePreferencesBody() {
  const { saveConsents } = useConsentManager()
  const [saving, setSaving] = useState(false)

  /**
   * Each toggle commits, matching the telemetry switch directly above it — one
   * interaction model on the page, and no "unsaved consent" state to reason
   * about. The banner stages instead, because its footer owns the commit.
   *
   * The switches lock while a commit is in flight, as the telemetry switch does
   * on its own mutation. Without that, two quick toggles race: each save sends
   * the whole `selectedConsents` snapshot, so the slower request can land last
   * and overwrite the newer choice. A failed commit puts the switch back rather
   * than leaving it showing a preference that was never recorded.
   */
  const commit = async ({ revert }: { revert: () => void }) => {
    setSaving(true)
    try {
      await saveConsents('custom', { uiSource: 'settings' })
    } catch (error) {
      revert()
      toast.error(getErrorMessage(error, 'Could not save your cookie preferences'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsSection label='Cookies'>
      <div className='flex flex-col gap-3'>
        <ConsentPreferences onChange={commit} disabled={saving} />
        <p className='text-[var(--text-muted)] text-small'>
          Your choice applies to this browser and is kept for 365 days. The{' '}
          <Link
            href='/cookie-policy'
            target='_blank'
            rel='noopener noreferrer'
            className={CONSENT_LINK_CLASS}
          >
            Cookie Policy
          </Link>{' '}
          lists what each category covers.
        </p>
      </div>
    </SettingsSection>
  )
}

/** The cookies section, backed by the root hosted consent store. */
export function CookiePreferences() {
  return <CookiePreferencesBody />
}
