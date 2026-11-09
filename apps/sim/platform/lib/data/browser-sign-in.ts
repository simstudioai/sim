'use client'

import { useSyncExternalStore } from 'react'
import type { BrowserContinueSignInResult } from '@sim/desktop-bridge'
import { toast } from '@/lib/toast/sink'
import {
  supportsContinueSignIn,
  useBringSignInBack,
  useBrowserImportProfiles,
  useCancelSignInHandoff,
  usePendingSignIn,
  useStartSignInHandoff,
} from '@/hooks/queries/browser-import'
import type { BrowserImportError, BrowserImportProfile } from '@/platform/lib/data/desktop/model'

export const IMPORT_ERROR_MESSAGES: Record<BrowserImportError, string> = {
  'unsupported-platform': 'Importing from another browser is only supported on macOS.',
  'chrome-not-found': 'Could not find that browser profile.',
  'keychain-unavailable':
    'Sim needs your permission to read that browser’s saved data. Allow the Keychain prompt and try again.',
  'profile-unreadable':
    'Could not read that browser’s data. Try quitting the other browser, then import again.',
  'unsupported-schema': 'That browser stores its data in a format Sim cannot read yet.',
  'nothing-imported': 'Nothing from that profile could be imported.',
  'vault-unavailable':
    'This device cannot store passwords securely, so saved passwords were not imported.',
  unknown: 'Could not import from that browser.',
}

const CONTINUE_ERROR_MESSAGES: Record<NonNullable<BrowserContinueSignInResult['error']>, string> = {
  'chrome-not-found': IMPORT_ERROR_MESSAGES['chrome-not-found'],
  'unsupported-page': 'This page can’t be continued in another browser.',
  'launch-failed': 'Could not open that browser.',
  unknown: 'Could not open this page in another browser.',
}

interface SignInHost {
  host: string
  /** Match the host's subdomains instead of the host itself. */
  subdomains?: true
  /** Restrict to these path prefixes; omit for the whole host. */
  paths?: readonly string[]
}

/**
 * Sign-in pages that commonly offer a passkey or security key the built-in browser cannot complete.
 * A hint only: the browser menu offers the same action on every https page, so a missing host costs
 * a suggestion, not the feature.
 */
const SIGN_IN_HOSTS: readonly SignInHost[] = [
  { host: 'accounts.google.com' },
  { host: 'signin.aws.amazon.com' },
  { host: 'signin.aws.amazon.com', subdomains: true },
  { host: 'awsapps.com', subdomains: true },
  { host: 'login.microsoftonline.com' },
  { host: 'login.live.com' },
  { host: 'okta.com', subdomains: true },
  { host: 'oktapreview.com', subdomains: true },
  { host: 'github.com', paths: ['/login', '/sessions/two-factor'] },
  { host: 'appleid.apple.com' },
  { host: 'auth0.com', subdomains: true },
]

/**
 * The page as a URL when another browser can continue it: https without embedded credentials, and
 * not one of Sim's own pages on `appOrigin`, all of which the shell refuses to hand off.
 */
export function continuablePage(url: string | undefined, appOrigin: string): URL | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.username || parsed.password) return null
    return parsed.protocol === 'https:' && parsed.origin !== appOrigin ? parsed : null
  } catch {
    return null
  }
}

function matchesPath(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

/**
 * The host to key the hint by when `page` is a known sign-in page, or null. Hosts match on label
 * boundaries, so `accounts.google.com.evil.com` or `evil-okta.com` never qualify.
 */
export function signInHintHost({ hostname, pathname }: URL): string | null {
  const matched = SIGN_IN_HOSTS.some(({ host, subdomains, paths }) => {
    const hostMatches = subdomains ? hostname.endsWith(`.${host}`) : hostname === host
    return hostMatches && (!paths || matchesPath(pathname, paths))
  })
  return matched ? hostname : null
}

/** Hosts whose hint the user dismissed, for as long as the app stays open. */
const dismissedHintHosts = new Set<string>()
const dismissalListeners = new Set<() => void>()

function subscribeToDismissals(listener: () => void): () => void {
  dismissalListeners.add(listener)
  return () => {
    dismissalListeners.delete(listener)
  }
}

const dismissalCount = () => dismissedHintHosts.size

/**
 * Finishing a sign-in in the user's own browser and bringing the session back (`continueSignIn` on
 * the desktop bridge). A shell without the bridge methods, a platform without the importer, or a
 * device with no importable browser leaves `canContinue` false, and every surface built on it hides.
 */
export function useContinueSignIn(scopeId: string, pageUrl: string | undefined) {
  const supported = supportsContinueSignIn()
  const { data: profiles = [] } = useBrowserImportProfiles(supported)
  const { data: pendingData = null, isSuccess: pendingKnown } = usePendingSignIn(scopeId, supported)
  const pending = supported ? pendingData : null
  const { mutateAsync: startHandoff, isPending: starting } = useStartSignInHandoff(scopeId)
  const { mutateAsync: importBack, isPending: importing } = useBringSignInBack(scopeId)
  const { mutate: cancelHandoff } = useCancelSignInHandoff(scopeId)
  useSyncExternalStore(subscribeToDismissals, dismissalCount, dismissalCount)

  const page = supported ? continuablePage(pageUrl, window.location.origin) : null
  // The profiles cache is shared with the import dialog, which older shells also support, so cached
  // profiles alone must not reveal this feature.
  const canContinue = supported && profiles.length > 0 && page !== null
  const hintHost = page ? signInHintHost(page) : null
  // Until the shell answers, a handoff may be pending; the hint's Continue would replace it.
  const hintVisible =
    canContinue &&
    pendingKnown &&
    pending === null &&
    hintHost !== null &&
    !dismissedHintHosts.has(hintHost)

  const continueIn = async (profile: BrowserImportProfile) => {
    try {
      const result = await startHandoff(profile.id)
      if (result.error) toast.error(CONTINUE_ERROR_MESSAGES[result.error])
    } catch {
      toast.error(CONTINUE_ERROR_MESSAGES.unknown)
    }
  }

  const bringBack = async () => {
    if (!pending) return
    const { site, browserLabel } = pending
    try {
      const result = await importBack()
      if (result.error) {
        toast.error(IMPORT_ERROR_MESSAGES[result.error])
      } else if (result.cookiesImported === 0) {
        toast.warning(
          `No sign-in for ${site} found in ${browserLabel}. Make sure you finished signing in.`
        )
      } else {
        toast.success(`Brought back your ${site} session from ${browserLabel}`)
      }
    } catch {
      toast.error(IMPORT_ERROR_MESSAGES.unknown)
    }
  }

  return {
    profiles,
    canContinue,
    pending,
    starting,
    importing,
    hintVisible,
    continueIn,
    bringBack,
    cancel: () => cancelHandoff(),
    dismissHint: () => {
      if (!hintHost) return
      dismissedHintHosts.add(hintHost)
      for (const listener of dismissalListeners) listener()
    },
  }
}
