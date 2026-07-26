import type {
  BrowserChromeImportResult,
  BrowserCredentialConflictPolicy,
  BrowserImportProfile,
  BrowserImportResult,
  BrowserPasswordImportResult,
} from '@sim/desktop-bridge'
import { importAgentCookies } from '@/main/browser-agent/session'
import { credentialsAvailable, importCredentials } from '@/main/browser-credentials'
import { readBrowserCookies } from '@/main/browser-import/chromium-cookies'
import { readSafeStoragePassword } from '@/main/browser-import/chromium-crypto'
import { readBrowserFavicons } from '@/main/browser-import/chromium-favicons'
import { readBrowserPasswords } from '@/main/browser-import/chromium-passwords'
import { listAllBrowserProfiles } from '@/main/browser-import/chromium-profiles'
import { readBrowserSiteNames } from '@/main/browser-import/chromium-site-names'
import {
  type ImportServiceDeps,
  listImportableProfiles,
  importChromeCookies as runCookieImport,
  importChromeData as runDataImport,
  importChromePasswords as runPasswordImport,
} from '@/main/browser-import/import-service'
import { rememberSites } from '@/main/browser-sites'

/**
 * Composition root for the Chrome importer: binds the real Keychain, profile,
 * database, browser-profile, and vault implementations to the policy in
 * `import-service`. The IPC layer talks to this module and nothing deeper.
 */
function deps(): ImportServiceDeps {
  return {
    platform: process.platform,
    listProfiles: () => listAllBrowserProfiles(),
    readSafeStoragePassword: (item) => readSafeStoragePassword(item),
    readCookies: (cookiesPath, key) => readBrowserCookies(cookiesPath, key),
    writeCookies: (cookies) => importAgentCookies(cookies),
    readPasswords: (loginDataPath, key) => readBrowserPasswords(loginDataPath, key),
    readFavicons: (faviconsPath, origins) => readBrowserFavicons(faviconsPath, origins),
    readSiteNames: (historyPath, hostnames) => readBrowserSiteNames(historyPath, hostnames),
    rememberSites: (records) => rememberSites(records),
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
