'use client'

import { useState } from 'react'
import { useConsentManager } from '@c15t/nextjs/headless'
import { getErrorMessage } from '@sim/utils/errors'
import { CONSENT_CATEGORY_COPY } from '@/lib/consent/copy'
import { ConsentStoreProvider } from '@/lib/consent/store-provider'
import { toast } from '@/platform/lib/data/toast'

export const CookieConsentProvider = ConsentStoreProvider

type ConsentCategoryName = Parameters<ReturnType<typeof useConsentManager>['setSelectedConsent']>[0]

/**
 * The hosted cookie choices. Each toggle commits, and a failed commit puts its switch back. `saving`
 * locks the switches while one is in flight: each save sends the whole selection, so two racing
 * requests could overwrite the newer choice.
 */
export function useCookieCategories() {
  const { consents, selectedConsents, setSelectedConsent, getDisplayedConsents, saveConsents } =
    useConsentManager()
  const [saving, setSaving] = useState(false)
  return {
    saving,
    categories: getDisplayedConsents().map((type) => {
      const copy = CONSENT_CATEGORY_COPY[type.name]
      return {
        name: type.name as ConsentCategoryName,
        title: copy?.title ?? type.name,
        description: copy?.description ?? type.description,
        locked: Boolean(type.disabled),
        checked: selectedConsents[type.name] ?? consents[type.name] ?? false,
      }
    }),
    commit: async (name: ConsentCategoryName, checked: boolean) => {
      setSelectedConsent(name, checked)
      setSaving(true)
      try {
        await saveConsents('custom', { uiSource: 'settings' })
      } catch (error) {
        setSelectedConsent(name, !checked)
        toast.error(getErrorMessage(error, 'Could not save your cookie preferences'))
      } finally {
        setSaving(false)
      }
    },
  }
}
