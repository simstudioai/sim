'use client'

import { useConsentManager } from '@c15t/nextjs/headless'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import { CONSENT_LINK_CLASS, ConsentPreferences } from '@/app/_shell/consent/consent-preferences'
import { ConsentStoreProvider } from '@/app/_shell/consent/consent-store-provider'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'

/**
 * Body of the cookies section, split out because it reads the consent store,
 * which only exists below the provider.
 */
function CookiePreferencesBody() {
  const { saveConsents } = useConsentManager()

  /**
   * Each toggle commits, matching the telemetry switch directly above it — one
   * interaction model on the page, and no "unsaved consent" state to reason
   * about. The banner stages instead, because its footer owns the commit.
   */
  const commit = async () => {
    try {
      await saveConsents('custom', { uiSource: 'settings' })
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not save your cookie preferences'))
    }
  }

  return (
    <SettingsSection label='Cookies'>
      <div className='flex flex-col gap-3'>
        <ConsentPreferences onChange={commit} />
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

/** The cookies section, with the store it reads. */
export function CookiePreferences() {
  return (
    <ConsentStoreProvider>
      <CookiePreferencesBody />
    </ConsentStoreProvider>
  )
}
