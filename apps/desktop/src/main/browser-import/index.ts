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

/**
 * A chat's handoff, created before the browser launches so a cancel, a newer
 * continue, sign-out, or the chat's id migrating during the launch can retire
 * or move it. A launch records its handoff only while its slot is still current.
 */
interface HandoffSlot {
  handoff?: SignInHandoff
}

/** At most one per chat: continuing another page replaces the previous slot. */
const slotsByScope = new Map<string, HandoffSlot>()

function pendingSignIn({ profile, scope }: SignInHandoff): BrowserPendingSignIn {
  return { site: scope.domain, browserLabel: profile.source.label }
}

function isCurrentSlot(slot: HandoffSlot): boolean {
  for (const current of slotsByScope.values()) if (current === slot) return true
  return false
}

/**
 * Opens a built-in browser page in one of the user's own browser profiles and
 * remembers it for the chat, so {@link bringSignInBack} imports the site the
 * user left from and reopens that page, whatever the tab shows by then.
 *
 * Only an https page goes, and only to a profile the importer can read back
 * from: a sign-in that can never return would strand the user. A handoff
 * retired while its browser launched resolves with neither `pending` nor
 * `error`.
 */
export async function continueSignIn(
  scopeId: string,
  request: { profileId: string; tabId: string; url: string }
): Promise<BrowserContinueSignInResult> {
  const scope = isSafeExternalUrl(request.url) ? siteScopeFor(new URL(request.url).hostname) : null
  if (!scope) return { error: 'unsupported-page' }
  const slot: HandoffSlot = {}
  slotsByScope.set(scopeId, slot)
  const profiles = await listAllBrowserProfiles().catch(() => [])
  const profile = profiles.find(({ id }) => id === request.profileId)
  if (!profile?.cookiesPath) return retire(slot, { error: 'chrome-not-found' })
  try {
    await openInBrowserProfile(profile.source.bundleId, profile.directory, request.url)
  } catch {
    return retire(slot, { error: 'launch-failed' })
  }
  if (!isCurrentSlot(slot)) return {}
  slot.handoff = { profile, tabId: request.tabId, url: request.url, scope }
  return { pending: pendingSignIn(slot.handoff) }
}

function retire(
  slot: HandoffSlot,
  result: BrowserContinueSignInResult
): BrowserContinueSignInResult {
  for (const [scopeId, current] of slotsByScope) {
    if (current === slot) slotsByScope.delete(scopeId)
  }
  return result
}

export function getPendingSignIn(scopeId: string): BrowserPendingSignIn | null {
  const handoff = slotsByScope.get(scopeId)?.handoff
  return handoff ? pendingSignIn(handoff) : null
}

export function cancelSignIn(scopeId: string): void {
  slotsByScope.delete(scopeId)
}

/** Follows a provisional chat to its saved id, including a launch still in flight. */
export function migrateSignIn(fromScopeId: string, toScopeId: string): void {
  const slot = slotsByScope.get(fromScopeId)
  if (!slot) return
  slotsByScope.delete(fromScopeId)
  slotsByScope.set(toScopeId, slot)
}

/** Account teardown: forgets every handoff and retires launches still in flight. */
export function clearSignIns(): void {
  slotsByScope.clear()
}

/**
 * Imports the chat's handed-off site from the profile it was continued in. The
 * handoff stays pending until something comes back, so the user can finish
 * signing in and try again. `current` is false when a cancel, a newer
 * continue, or teardown retired the handoff while it was being imported.
 */
export async function bringSignInBack(scopeId: string): Promise<{
  result: BrowserImportResult
  handoff?: { tabId: string; url: string }
  current?: boolean
}> {
  const slot = slotsByScope.get(scopeId)
  const handoff = slot?.handoff
  if (!slot || !handoff) return { result: cookieFailure('unknown') }
  const result = await runCookieImport(
    handoff.profile.id,
    { ...deps(), listProfiles: async () => [handoff.profile] },
    handoff.scope
  )
  const current = slotsByScope.get(scopeId) === slot && slot.handoff === handoff
  if (current && result.cookiesImported > 0) slotsByScope.delete(scopeId)
  return { result, handoff, current }
}
