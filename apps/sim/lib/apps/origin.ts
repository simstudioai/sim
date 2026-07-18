import { parse as parseDomain } from 'tldts'
import { env, getEnv } from '@/lib/core/config/env'

export const APP_ORIGIN_HEADER = 'x-sim-apps-hop'
export const APP_ABUSE_TOKEN_HEADER = 'x-sim-apps-abuse-token'

export type AppOriginStatus =
  | { enabled: true; appPublicOrigin: string; appHostname: string }
  | { enabled: false; reason: string }

/**
 * Registrable-domain (PSL) comparison between the Sim session cookie host
 * (derived from NEXT_PUBLIC_APP_URL) and APP_PUBLIC_ORIGIN.
 * Ports alone are never sufficient isolation.
 */
export function getRegistrableDomain(hostnameOrUrl: string): string | null {
  let hostname = hostnameOrUrl
  try {
    if (hostnameOrUrl.includes('://')) {
      hostname = new URL(hostnameOrUrl).hostname
    }
  } catch {
    return null
  }

  const parsed = parseDomain(hostname, { allowPrivateDomains: true })
  if (parsed.isIp) return hostname.toLowerCase()
  if (parsed.domain) return parsed.domain.toLowerCase()
  // localhost / single-label hosts: treat the full hostname as the isolation unit
  if (!hostname.includes('.')) return hostname.toLowerCase()
  return hostname.toLowerCase()
}

function hostnameOf(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase()
  } catch {
    return null
  }
}

function isLocalDevHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost')
}

export function originsShareCookieDomain(appOrigin: string, simOrigin: string): boolean {
  const appHost = hostnameOf(appOrigin)
  const simHost = hostnameOf(simOrigin)
  if (!appHost || !simHost) return true // fail closed

  // Local two-host recipe (sim.localhost + apps.localhost): browsers use host-only
  // cookies for *.localhost, so distinct hostnames are isolated even though PSL
  // groups them under "localhost".
  if (isLocalDevHost(appHost) && isLocalDevHost(simHost)) {
    return appHost === simHost
  }

  const appDomain = getRegistrableDomain(appOrigin)
  const simDomain = getRegistrableDomain(simOrigin)
  if (!appDomain || !simDomain) return true
  return appDomain === simDomain
}

/**
 * Startup / request-time gate for Full-stack Apps. When misconfigured,
 * preview/publish stay disabled with a clear reason.
 */
export function getAppOriginStatus(): AppOriginStatus {
  const appPublicOrigin = (getEnv('APP_PUBLIC_ORIGIN') || env.APP_PUBLIC_ORIGIN || '').trim()
  const simOrigin = (getEnv('NEXT_PUBLIC_APP_URL') || env.NEXT_PUBLIC_APP_URL || '').trim()

  if (!appPublicOrigin) {
    return {
      enabled: false,
      reason:
        'APP_PUBLIC_ORIGIN is not set. Full-stack Apps requires a distinct hostname outside the Sim cookie domain.',
    }
  }

  let appHostname: string
  try {
    appHostname = new URL(appPublicOrigin).hostname
  } catch {
    return { enabled: false, reason: 'APP_PUBLIC_ORIGIN is not a valid URL.' }
  }

  if (!simOrigin) {
    return { enabled: false, reason: 'NEXT_PUBLIC_APP_URL is required for Apps origin validation.' }
  }

  if (originsShareCookieDomain(appPublicOrigin, simOrigin)) {
    return {
      enabled: false,
      reason: `APP_PUBLIC_ORIGIN (${appHostname}) shares a registrable domain with the Sim session cookie host. Use a distinct registrable domain (e.g. apps.myproduct.dev vs app.sim.ai, or apps.localhost vs localhost).`,
    }
  }

  const hopSecret = (getEnv('APPS_PROXY_HOP_SECRET') || env.APPS_PROXY_HOP_SECRET || '').trim()
  if (!hopSecret || hopSecret.length < 32) {
    return {
      enabled: false,
      reason:
        'APPS_PROXY_HOP_SECRET must be set (min 32 chars) for the apps-domain → Sim hop proof.',
    }
  }

  return { enabled: true, appPublicOrigin: appPublicOrigin.replace(/\/$/, ''), appHostname }
}

export function isFullstackAppsEnabled(): boolean {
  return getAppOriginStatus().enabled
}

export function buildPublicAppUrl(publicId: string, slug: string): string {
  const status = getAppOriginStatus()
  if (!status.enabled) {
    throw new Error(status.reason)
  }
  return `${status.appPublicOrigin}/a/${publicId}/${slug}/`
}

export function getAppsFrameSrcSources(): string[] {
  const status = getAppOriginStatus()
  if (!status.enabled) return []
  return [status.appPublicOrigin]
}
