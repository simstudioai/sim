'use client'

import { useState } from 'react'
import { useConsentManager } from '@c15t/nextjs/headless'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import { saveDiscardActions } from '@/components/settings/save-discard-actions'
import { useSettingsUnsavedGuard } from '@/components/settings/use-settings-unsaved-guard'
import { CONSENT_LINK_CLASS, ConsentPreferences } from '@/app/_shell/consent/consent-preferences'
import { ConsentStoreProvider } from '@/app/_shell/consent/consent-store-provider'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'

/**
 * Body of the Privacy page, split from {@link Privacy} because it reads the
 * consent store, which only exists below the provider.
 */
function PrivacySettings() {
  const { consents, selectedConsents, setSelectedConsent, saveConsents } = useConsentManager()
  const [saving, setSaving] = useState(false)

  /**
   * `selectedConsents` is the runtime's staging copy of `consents`, so the two
   * diverging is exactly what "unsaved" means here.
   */
  const changed = (Object.keys(selectedConsents) as (keyof typeof selectedConsents)[]).filter(
    (name) => selectedConsents[name] !== consents[name]
  )
  useSettingsUnsavedGuard({ isDirty: changed.length > 0 })

  const save = async () => {
    setSaving(true)
    try {
      await saveConsents('custom', { uiSource: 'settings' })
      toast.success('Cookie preferences saved')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not save your cookie preferences'))
    } finally {
      setSaving(false)
    }
  }

  /** The store has no reset, so discard replays the saved value per changed category. */
  const discard = () => {
    for (const name of changed) {
      setSelectedConsent(name, consents[name])
    }
  }

  return (
    <SettingsPanel
      actions={saveDiscardActions({
        dirty: changed.length > 0,
        saving,
        onSave: save,
        onDiscard: discard,
      })}
    >
      <SettingsSection label='Cookies'>
        <ConsentPreferences />
      </SettingsSection>
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
    </SettingsPanel>
  )
}

/**
 * Privacy settings — where a signed-in user reviews and changes the cookie
 * choice they made in the banner.
 *
 * Shares the banner's store through {@link ConsentStoreProvider}. The banner
 * does not mount inside the workspace, so this is the product's only consent
 * surface.
 */
export function Privacy() {
  return (
    <ConsentStoreProvider>
      <PrivacySettings />
    </ConsentStoreProvider>
  )
}
