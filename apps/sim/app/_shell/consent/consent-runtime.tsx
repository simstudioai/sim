'use client'

import { type ConsentManagerOptions, ConsentManagerProvider } from '@c15t/nextjs/headless'
import {
  CONSENT_BACKEND_URL,
  CONSENT_CATEGORIES,
  DEV_CONSENT_COUNTRY,
} from '@/lib/consent/constants'
import { ConsentBanner } from '@/app/_shell/consent/consent-banner'

/**
 * Imported from `@c15t/nextjs/headless`, not the package root: the headless
 * entry leaves the runtime's own components and stylesheet out of the bundle,
 * so {@link ConsentBanner} is the only consent UI that exists. The provider
 * still injects a `<style id="c15t-theme">` block of `--c15t-*` variables that
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
  store: { iframeBlockerConfig: { disableAutomaticBlocking: true } },
  ...(DEV_CONSENT_COUNTRY ? { overrides: { country: DEV_CONSENT_COUNTRY } } : {}),
} satisfies ConsentManagerOptions

export function ConsentRuntime() {
  return (
    <ConsentManagerProvider options={CONSENT_OPTIONS}>
      <ConsentBanner />
    </ConsentManagerProvider>
  )
}
