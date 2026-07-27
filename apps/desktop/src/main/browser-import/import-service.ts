import type {
  BrowserChromeImportResult,
  BrowserCredentialConflictPolicy,
  BrowserImportProfile,
  BrowserImportResult,
  BrowserPasswordImportResult,
} from '@sim/desktop-bridge'
import { createLogger } from '@sim/logger'
import { normalizeOrigin } from '@/main/browser-credentials/origin'
import type { ImportCandidate, ImportOutcome } from '@/main/browser-credentials/vault'
import type { ReadCookiesResult } from '@/main/browser-import/chromium-cookies'
import { deriveEncryptionKey } from '@/main/browser-import/chromium-crypto'
import type { ReadPasswordsResult } from '@/main/browser-import/chromium-passwords'
import type { ImportedSite } from '@/main/browser-import/chromium-site-names'
import {
  type BrowserProfile,
  type ImportableCookie,
  ImportFailure,
  totalSkipped,
} from '@/main/browser-import/types'
import type { SiteRecord } from '@/main/browser-sites/directory'

const logger = createLogger('BrowserImport')

/**
 * Orchestrates Chrome imports.
 *
 * Every dependency is injected so the policy in this module — platform gating,
 * profile resolution, key lifetime, failure categorisation — can be tested
 * without a Keychain, a Chrome profile, an Electron session, or a real vault.
 */
export interface ImportServiceDeps {
  platform: NodeJS.Platform
  listProfiles: () => Promise<BrowserProfile[]>
  /** Reads one browser's Safe Storage key; the item comes from its source. */
  readSafeStoragePassword: (item: { service: string; account: string }) => Promise<string | null>
  readCookies: (cookiesPath: string, key: Buffer) => Promise<ReadCookiesResult>
  writeCookies: (cookies: ImportableCookie[]) => Promise<{ imported: number; failed: number }>
  readPasswords: (loginDataPath: string, key: Buffer) => Promise<ReadPasswordsResult>
  /** Site icons for the given origins, read from the source browser's own store. */
  readFavicons: (faviconsPath: string, origins: ReadonlySet<string>) => Promise<Map<string, string>>
  /** The most-used hosts in the source browser's history that `domains` covers. */
  readSites: (historyPath: string, domains: ReadonlySet<string>) => Promise<ImportedSite[]>
  /** Records the hosts an import brought over, with their names and icons. */
  rememberSites: (records: readonly SiteRecord[]) => Promise<void>
  vault: {
    isAvailable: () => boolean
    importCredentials: (
      candidates: ImportCandidate[],
      policy: BrowserCredentialConflictPolicy
    ) => Promise<ImportOutcome>
  }
}

function cookieFailure(error: BrowserImportResult['error']): BrowserImportResult {
  return { cookiesImported: 0, cookiesSkipped: 0, error }
}

function passwordFailure(error: BrowserImportResult['error']): BrowserPasswordImportResult {
  return { passwordsAdded: 0, passwordsUpdated: 0, passwordsSkipped: 0, error }
}

/**
 * Resolves the profile to read and derives its decryption key.
 *
 * A renderer-supplied id is matched against what was actually discovered and
 * is never joined into a path, so it cannot escape Chrome's directory, and an
 * unknown id is refused rather than quietly falling back to the default
 * profile — that would read the wrong account.
 */
interface OpenProfile {
  profile: BrowserProfile
  key: Buffer
}

/**
 * Wipes the derived key once every read that needs it is done. (The password
 * string itself is immutable and cannot be wiped; it is never persisted or
 * logged.)
 */
function zeroKey({ key }: OpenProfile): void {
  key.fill(0)
}

async function openBrowserProfile(
  profileId: string | undefined,
  deps: ImportServiceDeps
): Promise<OpenProfile> {
  const profiles = await deps.listProfiles()
  const profile = profileId ? profiles.find(({ id }) => id === profileId) : profiles[0]
  if (!profile) {
    throw new ImportFailure('chrome-not-found', 'No matching browser profile.')
  }
  // Each browser has its own Safe Storage item, so the prompt the user sees
  // names the browser they actually chose.
  const safeStoragePassword = await deps.readSafeStoragePassword(profile.source.keychain)
  if (safeStoragePassword === null) {
    throw new ImportFailure('keychain-unavailable', 'Keychain access was unavailable.')
  }
  return { profile, key: deriveEncryptionKey(safeStoragePassword) }
}

/**
 * Chrome profiles offered to the user, stripped to what the UI needs. Returns
 * an empty list rather than throwing when Chrome is absent or unsupported.
 */
export async function listImportableProfiles(
  deps: ImportServiceDeps
): Promise<BrowserImportProfile[]> {
  if (deps.platform !== 'darwin') return []
  try {
    return toDisplayProfiles(await deps.listProfiles())
  } catch {
    return []
  }
}

/**
 * Turns discovered profiles into things a person can pick between.
 *
 * The browser is the identity that matters — "Arc", not "Microtrades" — so
 * every label leads with it, and a profile name is only appended when the user
 * actually gave the profile one. Two unnamed profiles in the same browser fall
 * back to the directory, because a list with the same entry twice is worse
 * than one with an ugly entry.
 */
export function toDisplayProfiles(profiles: BrowserProfile[]): BrowserImportProfile[] {
  const unnamedPerBrowser = new Map<string, number>()
  for (const { source, label } of profiles) {
    if (label === '') {
      unnamedPerBrowser.set(source.id, (unnamedPerBrowser.get(source.id) ?? 0) + 1)
    }
  }

  return profiles.map(({ id, label, directory, source }) => {
    let suffix = label
    if (suffix === '' && (unnamedPerBrowser.get(source.id) ?? 0) > 1) {
      suffix = directory
    }
    return {
      id,
      label: suffix === '' ? source.label : `${source.label} · ${suffix}`,
      browserId: source.id,
      browserLabel: source.label,
      // Shown on its own in a profile picker, where the browser is already
      // chosen — so an unnamed profile reads as "Default" rather than blank.
      profileLabel: label === '' ? directory : label,
    }
  })
}

/**
 * Copies one Chrome profile's cookies into the built-in browser.
 *
 * Fails closed at every step: an unsupported platform, an absent Chrome, a
 * refused Keychain prompt, or an unrecognised database all stop the import
 * with a category instead of falling back to a weaker path. The result carries
 * counts only — no cookie material, domain, or path reaches the caller.
 */
export async function importChromeCookies(
  profileId: string | undefined,
  deps: ImportServiceDeps
): Promise<BrowserImportResult> {
  if (deps.platform !== 'darwin') return cookieFailure('unsupported-platform')

  try {
    const open = await openBrowserProfile(profileId, deps)
    let outcome: CookieOutcome
    try {
      outcome = await runCookieImport(open, deps)
    } finally {
      zeroKey(open)
    }
    await rememberImportedSites(outcome.domains, open.profile, deps)
    return outcome.result
  } catch (error) {
    return cookieFailure(categorize(error, 'cookie'))
  }
}

/** What an import half brought over, and the hosts it can vouch for. */
interface CookieOutcome {
  result: BrowserImportResult
  domains: Set<string>
}

interface PasswordOutcome {
  result: BrowserPasswordImportResult
  domains: Set<string>
}

/**
 * The cookie half against an already-open profile.
 *
 * Key lifetime belongs to the caller: the combined import shares one key across
 * both halves, so this must not wipe it out from under the password half.
 */
async function runCookieImport(
  { profile, key }: OpenProfile,
  deps: ImportServiceDeps
): Promise<CookieOutcome> {
  if (profile.cookiesPath === null) {
    return { result: cookieFailure('profile-unreadable'), domains: new Set() }
  }

  const read = await deps.readCookies(profile.cookiesPath, key)
  const skippedReading = totalSkipped(read.skipped)
  // Rows present but nothing usable means the profile did not decrypt —
  // typically a scheme this importer does not support. Report it as a
  // failure rather than as a successful import of zero cookies.
  if (read.cookies.length === 0) {
    return {
      result:
        read.rowsSeen > 0
          ? { cookiesImported: 0, cookiesSkipped: skippedReading, error: 'nothing-imported' }
          : { cookiesImported: 0, cookiesSkipped: 0 },
      domains: new Set(),
    }
  }

  const written = await deps.writeCookies(read.cookies)
  const result: BrowserImportResult = {
    cookiesImported: written.imported,
    cookiesSkipped: skippedReading + written.failed,
  }
  // Counts only: cookie names, values, domains, and the profile path are
  // deliberately absent from local diagnostics.
  logger.info('Chrome cookie import finished', {
    imported: result.cookiesImported,
    skipped: result.cookiesSkipped,
  })
  return { result, domains: cookieHostnames(read.cookies) }
}

/**
 * Copies one Chrome profile's saved passwords into the encrypted vault.
 *
 * Refuses to run when secure storage is unavailable: there is no plaintext
 * fallback for passwords, so an unavailable vault ends the import rather than
 * degrading it. Decrypted passwords pass straight from the reader into the
 * vault and are never logged or counted per site.
 */
export async function importChromePasswords(
  profileId: string | undefined,
  policy: BrowserCredentialConflictPolicy,
  deps: ImportServiceDeps
): Promise<BrowserPasswordImportResult> {
  if (deps.platform !== 'darwin') return passwordFailure('unsupported-platform')
  if (!deps.vault.isAvailable()) return passwordFailure('vault-unavailable')

  try {
    const open = await openBrowserProfile(profileId, deps)
    let outcome: PasswordOutcome
    try {
      outcome = await runPasswordImport(open, policy, deps)
    } finally {
      zeroKey(open)
    }
    await rememberImportedSites(outcome.domains, open.profile, deps)
    return outcome.result
  } catch (error) {
    return passwordFailure(categorize(error, 'password'))
  }
}

/** The password half against an already-open profile. @see runCookieImport */
async function runPasswordImport(
  { profile, key }: OpenProfile,
  policy: BrowserCredentialConflictPolicy,
  deps: ImportServiceDeps
): Promise<PasswordOutcome> {
  if (profile.loginDataPath === null) {
    return { result: passwordFailure('profile-unreadable'), domains: new Set() }
  }

  const read: ReadPasswordsResult = await deps.readPasswords(profile.loginDataPath, key)
  if (read.credentials.length === 0) {
    return {
      result:
        read.rowsSeen > 0
          ? {
              passwordsAdded: 0,
              passwordsUpdated: 0,
              passwordsSkipped: read.skipped,
              error: 'nothing-imported',
            }
          : { passwordsAdded: 0, passwordsUpdated: 0, passwordsSkipped: 0 },
      domains: new Set(),
    }
  }

  const outcome = await deps.vault.importCredentials(
    await withFavicons(read.credentials, profile.faviconsPath, deps),
    policy
  )
  const result: BrowserPasswordImportResult = {
    passwordsAdded: outcome.added,
    passwordsUpdated: outcome.updated,
    passwordsSkipped: outcome.skipped + read.skipped,
  }
  logger.info('Chrome password import finished', {
    added: result.passwordsAdded,
    updated: result.passwordsUpdated,
    skipped: result.passwordsSkipped,
  })
  return { result, domains: credentialHostnames(read.credentials) }
}

/**
 * Imports cookies and saved passwords in one action.
 *
 * Deliberately one call rather than two from the UI: the Keychain prompt can
 * easily outlive the page's transient user activation, so a second gated call
 * afterwards would be refused for a user who did nothing wrong. Each half
 * still reports its own outcome, so one failing does not hide the other.
 *
 * The profile is opened ONCE for both halves. Calling the two exported halves
 * in sequence would read the Safe Storage item twice, and a user who answered
 * the first Keychain prompt with "Allow" rather than "Always Allow" gets a
 * second prompt they did not ask for — which, arriving without a user gesture
 * behind it, is exactly the failure this combined entry point exists to
 * prevent. One open also means one history read, over the union of what both
 * halves vouched for. (The favicon store is still read twice — once for the
 * saved-password origins, once for the history hosts — because the two sets are
 * only known at different points.)
 */
export async function importChromeData(
  profileId: string | undefined,
  policy: BrowserCredentialConflictPolicy,
  deps: ImportServiceDeps
): Promise<BrowserChromeImportResult> {
  if (deps.platform !== 'darwin') {
    return {
      cookies: cookieFailure('unsupported-platform'),
      passwords: passwordFailure('unsupported-platform'),
    }
  }

  let open: OpenProfile
  try {
    open = await openBrowserProfile(profileId, deps)
  } catch (error) {
    // Neither half ran, so both report the same reason rather than one of them
    // claiming a success it never attempted.
    return {
      cookies: cookieFailure(categorize(error, 'cookie')),
      passwords: passwordFailure(categorize(error, 'password')),
    }
  }

  let cookies: CookieOutcome = { result: cookieFailure('unknown'), domains: new Set() }
  let passwords: PasswordOutcome = { result: passwordFailure('unknown'), domains: new Set() }
  try {
    try {
      cookies = await runCookieImport(open, deps)
    } catch (error) {
      cookies = { result: cookieFailure(categorize(error, 'cookie')), domains: new Set() }
    }
    // One half failing must not take the other with it.
    try {
      passwords = deps.vault.isAvailable()
        ? await runPasswordImport(open, policy, deps)
        : { result: passwordFailure('vault-unavailable'), domains: new Set() }
    } catch (error) {
      passwords = { result: passwordFailure(categorize(error, 'password')), domains: new Set() }
    }
  } finally {
    zeroKey(open)
  }

  await rememberImportedSites(union(cookies.domains, passwords.domains), open.profile, deps)
  return { cookies: cookies.result, passwords: passwords.result }
}

function union(first: ReadonlySet<string>, second: ReadonlySet<string>): Set<string> {
  return new Set([...first, ...second])
}

/**
 * Attaches each credential's site icon, where the source browser has one.
 *
 * Icons are cosmetic, so a profile without a favicon store — or a favicon
 * store that will not read — returns the credentials unchanged rather than
 * failing an import that otherwise succeeded.
 */
async function withFavicons(
  credentials: ImportCandidate[],
  faviconsPath: string | null,
  deps: ImportServiceDeps
): Promise<ImportCandidate[]> {
  if (faviconsPath === null) return credentials
  // Only the origins being imported are looked up, so a password import never
  // drags the browser's whole history along with it.
  const origins = new Set(
    credentials.flatMap((candidate) => {
      const origin = normalizeOrigin(candidate.origin)
      return origin === null ? [] : [origin]
    })
  )

  const icons = await deps
    .readFavicons(faviconsPath, origins)
    .catch(() => new Map<string, string>())
  if (icons.size === 0) return credentials

  return credentials.map((candidate) => {
    const icon = icons.get(normalizeOrigin(candidate.origin) ?? '')
    return icon ? { ...candidate, icon } : candidate
  })
}

/** The hosts a set of cookies belongs to, with the domain-cookie dot removed. */
function cookieHostnames(cookies: readonly ImportableCookie[]): Set<string> {
  const hostnames = new Set<string>()
  for (const cookie of cookies) {
    const hostname = hostnameOf(cookie.url)
    if (hostname) hostnames.add(hostname)
  }
  return hostnames
}

function credentialHostnames(credentials: readonly ImportCandidate[]): Set<string> {
  const hostnames = new Set<string>()
  for (const candidate of credentials) {
    const hostname = hostnameOf(candidate.origin)
    if (hostname) hostnames.add(hostname)
  }
  return hostnames
}

/**
 * Chrome stores Android app credentials with an `android://…@com.example.app/`
 * realm, so without a scheme guard a package name would pass as a host and
 * reach the omnibox as a site nothing can navigate to.
 */
function hostnameOf(url: string): string | null {
  try {
    const { hostname, protocol } = new URL(url)
    if (protocol !== 'https:' && protocol !== 'http:') return null
    return hostname || null
  } catch {
    return null
  }
}

/**
 * Records the sites this import brought over, so the omnibox can offer them —
 * as "Gmail" rather than `mail.google.com` where the source browser knew that.
 *
 * `domains` are the hosts the import has evidence for: cookie hosts with the
 * domain dot stripped, plus saved-password origins. They are the FILTER; the
 * source browser's history is the SOURCE. Being sourced from pages someone
 * opened is what keeps trackers out — a cookie jar would be mostly ad networks.
 * The filter's job is narrower: it holds what gets remembered inside the data
 * the user chose to bring over. See {@link readBrowserSites}.
 *
 * Each record is keyed by the host actually visited, so the favicon lookup and
 * the omnibox agree on the string.
 *
 * Cannot throw. A name and an icon are a nicety layered on cookies and
 * passwords that have already landed, so no failure in here — including a
 * synchronous one from a dependency — may reach the caller and rewrite a
 * finished import as a failed one.
 */
async function rememberImportedSites(
  domains: ReadonlySet<string>,
  profile: BrowserProfile,
  deps: ImportServiceDeps
): Promise<void> {
  if (domains.size === 0 || !profile.historyPath) return

  try {
    const sites = await deps.readSites(profile.historyPath, domains)
    if (sites.length === 0) return

    const origins = new Set(sites.map((site) => originOf(site.hostname)))
    const icons = profile.faviconsPath
      ? await deps
          .readFavicons(profile.faviconsPath, origins)
          .catch(() => new Map<string, string>())
      : new Map<string, string>()

    const importedAt = new Date().toISOString()
    await deps.rememberSites(
      sites.map((site) => ({
        hostname: site.hostname,
        name: site.name,
        icon: icons.get(originOf(site.hostname)),
        visits: site.visits,
        importedAt,
      }))
    )
  } catch {
    // Category only, like every other failure path here: the detail that would
    // make this message useful is the hostnames, which is exactly what must not
    // reach a local log. Without the line, a directory that can never be
    // written leaves the omnibox permanently empty with no signal anywhere.
    logger.warn('Could not record the sites an import brought over')
  }
}

const originOf = (hostname: string) => `https://${hostname}`

function categorize(error: unknown, kind: 'cookie' | 'password'): BrowserImportResult['error'] {
  if (error instanceof ImportFailure) {
    logger.warn(`Chrome ${kind} import failed`, { code: error.code })
    return error.code
  }
  logger.warn(`Chrome ${kind} import failed with an unexpected error`)
  return 'unknown'
}
