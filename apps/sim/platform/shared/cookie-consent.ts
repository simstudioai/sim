'use client'

import { useState } from 'react'
import { useConsentManager, useHeadlessConsentUI } from '@c15t/nextjs/headless'
import { getErrorMessage } from '@sim/utils/errors'
import { CONSENT_CATEGORY_COPY } from '@/lib/consent/copy'
import { toast } from '@/lib/toast/sink'

export const cookieChoices = Object.entries(CONSENT_CATEGORY_COPY).flatMap(([name, copy]) =>
  copy ? [{ name, ...copy, locked: name === 'necessary' }] : []
)

type ConsentManager = ReturnType<typeof useConsentManager>

type ConsentCategoryName = Parameters<ConsentManager['setSelectedConsent']>[0]

/** The displayed categories with Sim's copy, checked from the staged selection over the saved one. */
function readCategories({ consents, selectedConsents, getDisplayedConsents }: ConsentManager) {
  return getDisplayedConsents().map((type) => {
    const copy = CONSENT_CATEGORY_COPY[type.name]
    return {
      name: type.name as ConsentCategoryName,
      title: copy?.title ?? type.name,
      description: copy?.description ?? type.description,
      locked: Boolean(type.disabled),
      checked: selectedConsents[type.name] ?? consents[type.name] ?? false,
    }
  })
}

/**
 * The hosted cookie choices. Each toggle commits, and a failed commit puts its switch back. `saving`
 * locks the switches while one is in flight: each save sends the whole selection, so two racing
 * requests could overwrite the newer choice.
 */
export function useCookieCategories() {
  const manager = useConsentManager()
  const { setSelectedConsent, saveConsents } = manager
  const [saving, setSaving] = useState(false)
  return {
    saving,
    categories: readCategories(manager),
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

/**
 * The first-visit banner. It shows only when the resolved jurisdiction policy asks, never from the
 * generic opt-in policy the runtime substitutes when its policy lookup fails; a dialog the visitor
 * opened themselves still shows. Customize expands the same card, whose switches stage a selection
 * that Save commits, and every action is one the policy allows.
 */
export function useConsentBanner() {
  const { banner, dialog, openDialog, performAction, saveCustomPreferences } =
    useHeadlessConsentUI()
  const manager = useConsentManager()
  const expanded = dialog.isVisible
  const surface = expanded ? 'dialog' : 'banner'
  return {
    visible: (manager.initDataSource !== 'offline-fallback' && banner.isVisible) || expanded,
    expanded,
    allowedActions: (expanded ? dialog : banner).allowedActions,
    categories: readCategories(manager),
    stage: manager.setSelectedConsent,
    customize: openDialog,
    choose: (action: 'accept' | 'reject') => performAction(action, { surface }),
    save: () => saveCustomPreferences(),
  }
}
