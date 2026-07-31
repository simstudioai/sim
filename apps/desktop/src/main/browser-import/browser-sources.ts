import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The Chromium-family browsers Sim can import from on macOS.
 *
 * Every one of these shares Chromium's profile layout and its `OSCrypt`
 * encryption, so a single reader handles all of them. What actually differs
 * between browsers is only two things: where the user-data directory lives,
 * and which login-Keychain item holds the Safe Storage password. That is what
 * this table is.
 *
 * Safari is deliberately absent and cannot be added here. It stores cookies in
 * an undocumented binary format inside a TCC-protected container (reading it
 * would require Full Disk Access, a far broader grant than a Keychain prompt),
 * and its passwords are iCloud Keychain items with per-item ACLs rather than a
 * database — there is no key to derive and nothing to decrypt. The supported
 * path for Safari is a user-driven CSV export.
 */
export interface BrowserSource {
  /** Stable, opaque identifier used to namespace profile ids. */
  id: string
  /** Product name as the user knows it. */
  label: string
  /** User-data directory, relative to the home directory. */
  userDataSegments: readonly string[]
  /** The login-Keychain generic-password item holding the Safe Storage key. */
  keychain: { service: string; account: string }
}

export const BROWSER_SOURCES: readonly BrowserSource[] = [
  {
    id: 'chrome',
    label: 'Chrome',
    userDataSegments: ['Library', 'Application Support', 'Google', 'Chrome'],
    keychain: { service: 'Chrome Safe Storage', account: 'Chrome' },
  },
  {
    id: 'arc',
    label: 'Arc',
    userDataSegments: ['Library', 'Application Support', 'Arc', 'User Data'],
    keychain: { service: 'Arc Safe Storage', account: 'Arc' },
  },
  {
    id: 'dia',
    label: 'Dia',
    userDataSegments: ['Library', 'Application Support', 'Dia', 'User Data'],
    keychain: { service: 'Dia Safe Storage', account: 'Dia' },
  },
  {
    id: 'brave',
    label: 'Brave',
    userDataSegments: ['Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'],
    keychain: { service: 'Brave Safe Storage', account: 'Brave' },
  },
  {
    id: 'edge',
    label: 'Microsoft Edge',
    userDataSegments: ['Library', 'Application Support', 'Microsoft Edge'],
    keychain: { service: 'Microsoft Edge Safe Storage', account: 'Microsoft Edge' },
  },
  {
    id: 'vivaldi',
    label: 'Vivaldi',
    userDataSegments: ['Library', 'Application Support', 'Vivaldi'],
    keychain: { service: 'Vivaldi Safe Storage', account: 'Vivaldi' },
  },
  {
    id: 'chromium',
    label: 'Chromium',
    userDataSegments: ['Library', 'Application Support', 'Chromium'],
    keychain: { service: 'Chromium Safe Storage', account: 'Chromium' },
  },
] as const

export function userDataDirFor(source: BrowserSource, home: string = homedir()): string {
  return join(home, ...source.userDataSegments)
}

/**
 * Splits a bridge profile id back into its browser and profile directory.
 *
 * Ids are namespaced (`arc:Profile 1`) because profile directory names repeat
 * across browsers — every one of them has a `Default`. Returns null for
 * anything malformed; the caller then resolves against discovered profiles
 * anyway, so a bad id can never become a path.
 */
export function parseProfileId(profileId: string): { sourceId: string; directory: string } | null {
  const separator = profileId.indexOf(':')
  if (separator <= 0 || separator === profileId.length - 1) return null
  return {
    sourceId: profileId.slice(0, separator),
    directory: profileId.slice(separator + 1),
  }
}

export function formatProfileId(sourceId: string, directory: string): string {
  return `${sourceId}:${directory}`
}
