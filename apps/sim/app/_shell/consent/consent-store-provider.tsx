'use client'

import type { ReactNode } from 'react'
import { type ConsentManagerOptions, ConsentManagerProvider } from '@c15t/nextjs/headless'
import {
  CONSENT_BACKEND_URL,
  CONSENT_CATEGORIES,
  DEV_CONSENT_COUNTRY,
} from '@/lib/consent/constants'

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
  store: { iframeBlockerConfig: { disableAutomaticBlocking: true } },
  ...(DEV_CONSENT_COUNTRY ? { overrides: { country: DEV_CONSENT_COUNTRY } } : {}),
} satisfies ConsentManagerOptions

/**
 * The consent store, for the two surfaces that read it: the banner on public
 * pages and the Privacy settings page inside the workspace.
 *
 * They mount separately — the banner sits behind an `ssr: false` boundary that
 * cannot wrap the app, so nothing reaches it through React context — yet share
 * one store, because `getOrCreateConsentRuntime` caches manager and store by
 * the option values. Keeping the options private to this component is what
 * makes that structural: two call sites cannot drift into two stores.
 */
export function ConsentStoreProvider({ children }: { children: ReactNode }) {
  return <ConsentManagerProvider options={CONSENT_OPTIONS}>{children}</ConsentManagerProvider>
}
