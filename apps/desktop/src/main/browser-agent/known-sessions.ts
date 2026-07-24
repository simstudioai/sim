import { isIP } from 'node:net'
import type {
  BrowserKnownSession,
  BrowserKnownSessionsState,
  BrowserSessionEvidence,
} from '@sim/browser-protocol'
import type { BrowserKnownSiteSetting, ConfigStore, DesktopSettings } from '@/main/config'

const MAX_STORED_SITES = 100
const MAX_EXPOSED_SESSIONS = 20
const SITE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000
const VISIT_WRITE_INTERVAL_MS = 60 * 60 * 1000

export interface BrowserCookieSignal {
  domain: string
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

export function normalizePublicHostname(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const candidate = value
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, '')
  if (
    candidate.length === 0 ||
    candidate.length > 253 ||
    !candidate.includes('.') ||
    isIP(candidate) !== 0 ||
    !/^[a-z0-9.-]+$/.test(candidate)
  ) {
    return null
  }
  try {
    const parsed = new URL(`https://${candidate}`)
    return parsed.hostname === candidate ? candidate : null
  } catch {
    return null
  }
}

function hostnameFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return normalizePublicHostname(url.hostname)
  } catch {
    return null
  }
}

function sanitizeRecords(
  raw: DesktopSettings['browserKnownSites'],
  now: number
): BrowserKnownSiteSetting[] {
  if (!Array.isArray(raw)) return []
  const cutoff = now - SITE_MAX_AGE_MS
  const byHostname = new Map<string, BrowserKnownSiteSetting>()
  for (const candidate of raw) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const hostname = normalizePublicHostname(candidate.hostname)
    const lastVisitedAtMs = parseTimestamp(candidate.lastVisitedAt)
    if (
      !hostname ||
      lastVisitedAtMs === null ||
      lastVisitedAtMs < cutoff ||
      lastVisitedAtMs > now
    ) {
      continue
    }
    const signInCompletedAtMs = parseTimestamp(candidate.signInCompletedAt)
    const normalized: BrowserKnownSiteSetting = {
      hostname,
      lastVisitedAt: new Date(lastVisitedAtMs).toISOString(),
      ...(signInCompletedAtMs !== null &&
      signInCompletedAtMs >= cutoff &&
      signInCompletedAtMs <= now
        ? { signInCompletedAt: new Date(signInCompletedAtMs).toISOString() }
        : {}),
    }
    const existing = byHostname.get(hostname)
    if (!existing || Date.parse(existing.lastVisitedAt) < lastVisitedAtMs) {
      byHostname.set(hostname, normalized)
    } else if (normalized.signInCompletedAt) {
      const previousSignIn = parseTimestamp(existing.signInCompletedAt) ?? 0
      if (signInCompletedAtMs !== null && signInCompletedAtMs > previousSignIn) {
        existing.signInCompletedAt = normalized.signInCompletedAt
      }
    }
  }
  return [...byHostname.values()]
    .sort((a, b) => Date.parse(b.lastVisitedAt) - Date.parse(a.lastVisitedAt))
    .slice(0, MAX_STORED_SITES)
}

function recordsEqual(
  left: BrowserKnownSiteSetting[] | undefined,
  right: BrowserKnownSiteSetting[]
): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right)
}

function cookieMatchesHost(cookieDomain: string, hostname: string): boolean {
  const domain = normalizePublicHostname(cookieDomain)
  return domain !== null && (hostname === domain || hostname.endsWith(`.${domain}`))
}

/**
 * Tracks only top-level hostnames and coarse evidence in the local desktop
 * settings file. It deliberately cannot retain cookie material or page paths.
 */
export class BrowserKnownSessionRegistry {
  constructor(
    private readonly config: ConfigStore,
    private readonly now: () => number = Date.now
  ) {}

  noteTopLevelNavigation(rawUrl: string): void {
    const hostname = hostnameFromUrl(rawUrl)
    if (!hostname) return
    const now = this.now()
    const records = sanitizeRecords(this.config.get('browserKnownSites'), now)
    const existing = records.find((record) => record.hostname === hostname)
    if (existing && now - Date.parse(existing.lastVisitedAt) < VISIT_WRITE_INTERVAL_MS) {
      return
    }
    const updated: BrowserKnownSiteSetting = {
      hostname,
      lastVisitedAt: new Date(now).toISOString(),
      ...(existing?.signInCompletedAt ? { signInCompletedAt: existing.signInCompletedAt } : {}),
    }
    this.config.set(
      'browserKnownSites',
      [updated, ...records.filter((record) => record.hostname !== hostname)].slice(
        0,
        MAX_STORED_SITES
      )
    )
  }

  noteSignInCompleted(rawUrl: string): void {
    const hostname = hostnameFromUrl(rawUrl)
    if (!hostname) return
    const now = this.now()
    const observedAt = new Date(now).toISOString()
    const records = sanitizeRecords(this.config.get('browserKnownSites'), now)
    const updated: BrowserKnownSiteSetting = {
      hostname,
      lastVisitedAt: observedAt,
      signInCompletedAt: observedAt,
    }
    this.config.set(
      'browserKnownSites',
      [updated, ...records.filter((record) => record.hostname !== hostname)].slice(
        0,
        MAX_STORED_SITES
      )
    )
  }

  list(cookieSignals: BrowserCookieSignal[]): BrowserKnownSessionsState {
    const now = this.now()
    const stored = this.config.get('browserKnownSites')
    const records = sanitizeRecords(stored, now)
    if (!recordsEqual(stored, records)) {
      this.config.set('browserKnownSites', records)
    }

    const sessions: BrowserKnownSession[] = []
    for (const record of records) {
      let evidence: BrowserSessionEvidence | null = null
      let lastObservedAt = record.lastVisitedAt
      if (record.signInCompletedAt) {
        evidence = 'sign-in-completed'
        lastObservedAt = record.signInCompletedAt
      } else if (
        cookieSignals.some((cookie) => cookieMatchesHost(cookie.domain, record.hostname))
      ) {
        evidence = 'cookies'
      }
      if (evidence) {
        sessions.push({ hostname: record.hostname, evidence, lastObservedAt })
      }
    }

    sessions.sort((a, b) => {
      if (a.evidence !== b.evidence) return a.evidence === 'sign-in-completed' ? -1 : 1
      return Date.parse(b.lastObservedAt) - Date.parse(a.lastObservedAt)
    })
    return { sessions: sessions.slice(0, MAX_EXPOSED_SESSIONS) }
  }
}
