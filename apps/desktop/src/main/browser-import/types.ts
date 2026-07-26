import type { BrowserImportError } from '@sim/desktop-bridge'
import type { BrowserSource } from '@/main/browser-import/browser-sources'

/**
 * Shapes internal to the Chrome importer.
 *
 * Nothing declared here may cross the preload bridge: cookie values, cookie
 * names, and Chrome's host paths stay inside the Electron main process. Only
 * the counts in `BrowserImportResult` are ever returned to a renderer.
 */

/** One browser profile discovered on this device. */
export interface BrowserProfile {
  /** Namespaced `<browser>:<directory>` id, opaque to the renderer. */
  id: string
  /** The profile directory, used to tell unnamed profiles apart. */
  directory: string
  /** The name the user gave this profile, or empty when they never named it. */
  label: string
  /** Which browser it belongs to, carrying that browser's Keychain item. */
  source: BrowserSource
  /** That profile's cookie database, or null when it has none. Stays in main. */
  cookiesPath: string | null
  /** That profile's saved-password database, or null when it has none. */
  loginDataPath: string | null
  /** That profile's favicon store, or null when it has none. */
  faviconsPath: string | null
}

/** One row of Chrome's `cookies` table, coerced to plain JS types. */
export interface ChromiumCookieRow {
  hostKey: string
  name: string
  path: string
  expiresUtc: number
  isSecure: boolean
  isHttpOnly: boolean
  hasExpires: boolean
  isPersistent: boolean
  sameSite: number
}

/**
 * A cookie ready for Electron's `cookies.set`. Field names and the `sameSite`
 * union mirror `Electron.CookiesSetDetails` so the writer passes it straight
 * through without a second translation step.
 */
export interface ImportableCookie {
  url: string
  name: string
  value: string
  /** Set only for domain cookies (a leading-dot `host_key`). */
  domain?: string
  path: string
  secure: boolean
  httpOnly: boolean
  /** Omitted for session cookies. */
  expirationDate?: number
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

/**
 * Why a row was dropped. Aggregated into counts for local diagnostics — a skip
 * reason is never paired with the cookie it came from, in a log or anywhere
 * else.
 */
export type CookieSkipReason = 'decrypt-failed' | 'expired' | 'invalid-target' | 'empty'

export type CookieSkipCounts = Record<CookieSkipReason, number>

export function emptySkipCounts(): CookieSkipCounts {
  return { 'decrypt-failed': 0, expired: 0, 'invalid-target': 0, empty: 0 }
}

export function totalSkipped(counts: CookieSkipCounts): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0)
}

/** SQLite integers arrive as BigInt once BigInt reads are enabled. */
export function toNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value)
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function toText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * A failure carrying a category that is safe to hand to a renderer. The
 * message stays in the main process for local logs; only `code` is exposed.
 */
export class ImportFailure extends Error {
  constructor(
    readonly code: BrowserImportError,
    message: string
  ) {
    super(message)
    this.name = 'ImportFailure'
  }
}
