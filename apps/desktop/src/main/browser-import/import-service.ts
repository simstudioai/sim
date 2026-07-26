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
  /** What the source browser's page titles call each of the given hosts. */
  readSiteNames: (
    historyPath: string,
    hostnames: ReadonlySet<string>
  ) => Promise<Map<string, string>>
  /** Records the names and icons of the hosts an import brought over. */
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
async function openBrowserProfile(
  profileId: string | undefined,
  deps: ImportServiceDeps
): Promise<{ profile: BrowserProfile; key: Buffer }> {
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
    const { profile, key } = await openBrowserProfile(profileId, deps)
    if (profile.cookiesPath === null) {
      return cookieFailure('profile-unreadable')
    }

    let read: ReadCookiesResult
    try {
      read = await deps.readCookies(profile.cookiesPath, key)
    } finally {
      // The derived key has no reason to stay resident once the rows are
      // decrypted. (The password string itself is immutable and cannot be
      // wiped; it is never persisted or logged.)
      key.fill(0)
    }

    const skippedReading = totalSkipped(read.skipped)
    // Rows present but nothing usable means the profile did not decrypt —
    // typically a scheme this importer does not support. Report it as a
    // failure rather than as a successful import of zero cookies.
    if (read.cookies.length === 0) {
      return read.rowsSeen > 0
        ? { cookiesImported: 0, cookiesSkipped: skippedReading, error: 'nothing-imported' }
        : { cookiesImported: 0, cookiesSkipped: 0 }
    }

    const written = await deps.writeCookies(read.cookies)
    await rememberImportedSites(cookieHostnames(read.cookies), profile, deps, { icons: true })
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
    return result
  } catch (error) {
    return cookieFailure(categorize(error, 'cookie'))
  }
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
    const { profile, key } = await openBrowserProfile(profileId, deps)
    if (profile.loginDataPath === null) {
      return passwordFailure('profile-unreadable')
    }

    let read: ReadPasswordsResult
    try {
      read = await deps.readPasswords(profile.loginDataPath, key)
    } finally {
      key.fill(0)
    }

    if (read.credentials.length === 0) {
      return read.rowsSeen > 0
        ? {
            passwordsAdded: 0,
            passwordsUpdated: 0,
            passwordsSkipped: read.skipped,
            error: 'nothing-imported',
          }
        : { passwordsAdded: 0, passwordsUpdated: 0, passwordsSkipped: 0 }
    }

    const outcome = await deps.vault.importCredentials(
      await withFavicons(read.credentials, profile.faviconsPath, deps),
      policy
    )
    await rememberImportedSites(credentialHostnames(read.credentials), profile, deps, {
      icons: false,
    })
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
    return result
  } catch (error) {
    return passwordFailure(categorize(error, 'password'))
  }
}

/**
 * Imports cookies and saved passwords in one action.
 *
 * Deliberately one call rather than two from the UI: the Keychain prompt can
 * easily outlive the page's transient user activation, so a second gated call
 * afterwards would be refused for a user who did nothing wrong. Each half
 * still reports its own outcome, so one failing does not hide the other.
 */
export async function importChromeData(
  profileId: string | undefined,
  policy: BrowserCredentialConflictPolicy,
  deps: ImportServiceDeps
): Promise<BrowserChromeImportResult> {
  const cookies = await importChromeCookies(profileId, deps)
  const passwords = await importChromePasswords(profileId, policy, deps)
  return { cookies, passwords }
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

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname || null
  } catch {
    return null
  }
}

/**
 * Records what the imported hosts are called, so the omnibox can offer "Gmail"
 * rather than `mail.google.com`.
 *
 * Scoped to the hosts this import actually brought over — the source browser's
 * history is read, but only these hosts come out of it, and only as a name.
 * Entirely best-effort: a site nobody can name is still a site the user
 * imported, so nothing here is allowed to fail the import.
 */
async function rememberImportedSites(
  hostnames: ReadonlySet<string>,
  profile: BrowserProfile,
  deps: ImportServiceDeps,
  { icons: wantIcons }: { icons: boolean }
): Promise<void> {
  if (hostnames.size === 0) return
  const empty = new Map<string, string>()

  const names = profile.historyPath
    ? await deps.readSiteNames(profile.historyPath, hostnames).catch(() => empty)
    : empty
  // Saved passwords already carry their own icon on the vault record, so only
  // the cookie side needs to look one up here.
  const icons =
    wantIcons && profile.faviconsPath
      ? await deps
          .readFavicons(profile.faviconsPath, new Set([...hostnames].map(originOf)))
          .catch(() => empty)
      : empty

  const records: SiteRecord[] = []
  for (const hostname of hostnames) {
    const name = names.get(hostname)
    const icon = icons.get(originOf(hostname))
    if (name !== undefined || icon !== undefined) records.push({ hostname, name, icon })
  }
  await deps.rememberSites(records).catch(() => {})
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
