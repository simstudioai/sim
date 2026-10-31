import type {
  BrowserChromeImportResult,
  BrowserContinueSignInResult,
  BrowserCredentialConflictPolicy,
  BrowserImportProfile,
  BrowserImportResult,
  BrowserPasswordImportResult,
  BrowserPendingSignIn,
} from '@sim/desktop-bridge'
import {
  captureAccountDataGeneration,
  runAccountDataMutation,
} from '@/main/account-data-generation'
import { importAgentCookies } from '@/main/browser-agent/session'
import { credentialsAvailable, importCredentials } from '@/main/browser-credentials'
import { openInBrowserProfile } from '@/main/browser-import/browser-launch'
import { readBrowserCookies } from '@/main/browser-import/chromium-cookies'
import { readSafeStoragePassword } from '@/main/browser-import/chromium-crypto'
import { readBrowserFavicons } from '@/main/browser-import/chromium-favicons'
import { readBrowserPasswords } from '@/main/browser-import/chromium-passwords'
import { listAllBrowserProfiles } from '@/main/browser-import/chromium-profiles'
import { readBrowserSites } from '@/main/browser-import/chromium-site-names'
import {
  cookieFailure,
  type ImportServiceDeps,
  listImportableProfiles,
  importChromeCookies as runCookieImport,
  importChromeData as runDataImport,
  importChromePasswords as runPasswordImport,
} from '@/main/browser-import/import-service'
import { type SiteScope, siteScopeFor } from '@/main/browser-import/site-scope'
import type { BrowserProfile } from '@/main/browser-import/types'
import { rememberSites } from '@/main/browser-sites'
import { isSafeExternalUrl } from '@/main/navigation'

/**
 * Composition root for the Chrome importer: binds the real Keychain, profile,
 * database, browser-profile, and vault implementations to the policy in
 * `import-service`. The IPC layer talks to this module and nothing deeper.
 */
function deps(): ImportServiceDeps {
  const generation = captureAccountDataGeneration()
  return {
    platform: process.platform,
    listProfiles: () => listAllBrowserProfiles(),
    readSafeStoragePassword: (item) => readSafeStoragePassword(item),
    readCookies: (cookiesPath, key, scope) => readBrowserCookies(cookiesPath, key, { scope }),
    writeCookies: (cookies) => importAgentCookies(cookies),
    readPasswords: (loginDataPath, key) => readBrowserPasswords(loginDataPath, key),
    readFavicons: (faviconsPath, origins) => readBrowserFavicons(faviconsPath, origins),
    readSites: (historyPath, domains) => readBrowserSites(historyPath, domains),
    rememberSites: (records) => rememberSites(records),
    commit: (operation) => runAccountDataMutation(generation, operation),
    vault: {
      isAvailable: () => credentialsAvailable(),
      importCredentials: (candidates, policy) => importCredentials(candidates, policy),
    },
  }
}

export function listChromeImportProfiles(): Promise<BrowserImportProfile[]> {
  return listImportableProfiles(deps())
}

export function importChromeCookies(profileId?: string): Promise<BrowserImportResult> {
  return runCookieImport(profileId, deps())
}

export function importChromePasswords(
  profileId?: string,
  policy: BrowserCredentialConflictPolicy = 'keep-existing'
): Promise<BrowserPasswordImportResult> {
  return runPasswordImport(profileId, policy, deps())
}

export function importChromeData(
  profileId?: string,
  policy: BrowserCredentialConflictPolicy = 'keep-existing'
): Promise<BrowserChromeImportResult> {
  return runDataImport(profileId, policy, deps())
}

/** A page the user took to another browser to finish signing in. */
interface SignInHandoff {
  /** Resolved once, so bringing the sign-in back reads exactly this profile. */
  profile: BrowserProfile
  tabId: string
  url: string
  scope: SiteScope
}

/** At most one per chat: continuing another page replaces the previous handoff. */
const handoffsByScope = new Map<string, SignInHandoff>()

function pendingSignIn({ profile, scope }: SignInHandoff): BrowserPendingSignIn {
  return { site: scope.domain, browserLabel: profile.source.label }
}

/**
 * Opens a built-in browser page in one of the user's own browser profiles and
 * remembers it for the chat, so {@link bringSignInBack} imports the site the
 * user left from and reopens that page, whatever the tab shows by then.
 *
 * Only an https page goes, and only to a profile the importer can read back
 * from: a sign-in that can never return would strand the user.
 */
export async function continueSignIn(
  scopeId: string,
  request: { profileId: string; tabId: string; url: string }
): Promise<BrowserContinueSignInResult> {
  const scope = isSafeExternalUrl(request.url) ? siteScopeFor(new URL(request.url).hostname) : null
  if (!scope) return { error: 'unsupported-page' }
  const profiles = await listAllBrowserProfiles().catch(() => [])
  const profile = profiles.find(({ id }) => id === request.profileId)
  if (!profile?.cookiesPath) return { error: 'chrome-not-found' }
  try {
    await openInBrowserProfile(profile.source.bundleId, profile.directory, request.url)
  } catch {
    return { error: 'launch-failed' }
  }
  const handoff = { profile, tabId: request.tabId, url: request.url, scope }
  handoffsByScope.set(scopeId, handoff)
  return { pending: pendingSignIn(handoff) }
}

export function getPendingSignIn(scopeId: string): BrowserPendingSignIn | null {
  const handoff = handoffsByScope.get(scopeId)
  return handoff ? pendingSignIn(handoff) : null
}

export function cancelSignIn(scopeId: string): void {
  handoffsByScope.delete(scopeId)
}

/**
 * Imports the chat's handed-off site from the profile it was continued in. The
 * handoff stays pending until something comes back, so the user can finish
 * signing in and try again.
 */
export async function bringSignInBack(
  scopeId: string
): Promise<{ result: BrowserImportResult; handoff?: { tabId: string; url: string } }> {
  const handoff = handoffsByScope.get(scopeId)
  if (!handoff) return { result: cookieFailure('unknown') }
  const result = await runCookieImport(
    handoff.profile.id,
    { ...deps(), listProfiles: async () => [handoff.profile] },
    handoff.scope
  )
  if (result.cookiesImported > 0 && handoffsByScope.get(scopeId) === handoff) {
    handoffsByScope.delete(scopeId)
  }
  return { result, handoff }
}
