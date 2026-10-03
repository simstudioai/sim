'use client'

import type { ReactNode } from 'react'
import { type ConsentManagerOptions, ConsentManagerProvider } from '@c15t/nextjs/headless'
import {
  CONSENT_BACKEND_URL,
  CONSENT_CATEGORIES,
  DEV_CONSENT_COUNTRY,
} from '@/lib/consent/constants'
import { GLOBAL_CONSENT_SCRIPTS } from '@/lib/consent/scripts'
import { CONSENT_STORAGE_CONFIG } from '@/lib/consent/storage'

/**
 * Imported from `@c15t/nextjs/headless`, not the package root: the headless
 * entry leaves the runtime's own components and stylesheet out of the bundle,
 * so `ConsentBanner` is the only consent UI that exists. The provider still
 * injects a `<style id="c15t-theme">` block of `--c15t-*` variables that
 * nothing here reads; it is inert, since none of those names collide with
 * Sim's tokens.
 *
 * `disableAutomaticBlocking` turns off the runtime's iframe blocker, which
 * otherwise installs a `childList`/`subtree` MutationObserver on `document.body`
 * for the life of every hosted page — including the workflow canvas, the
 * highest-mutation surface in the app — and re-scans each added subtree for
 * iframes. Sim gates no iframes by consent, so it is pure overhead.
 */
const CONSENT_OPTIONS = {
  mode: 'hosted',
  backendURL: CONSENT_BACKEND_URL,
  consentCategories: [...CONSENT_CATEGORIES],
  scripts: [...GLOBAL_CONSENT_SCRIPTS],
  store: {
    storageConfig: CONSENT_STORAGE_CONFIG,
    reloadOnConsentRevoked: true,
    iframeBlockerConfig: { disableAutomaticBlocking: true },
  },
  ...(DEV_CONSENT_COUNTRY ? { overrides: { country: DEV_CONSENT_COUNTRY } } : {}),
} satisfies ConsentManagerOptions

/**
 * The single consent store for hosted Sim. It wraps the entire application so
 * script loading, the public banner, and workspace privacy settings cannot
 * observe different consent state.
 */
export function ConsentStoreProvider({ children }: { children: ReactNode }) {
  return <ConsentManagerProvider options={CONSENT_OPTIONS}>{children}</ConsentManagerProvider>
}
