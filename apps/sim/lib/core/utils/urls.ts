import { env, getEnv } from '@/lib/core/config/env'
import { isProd } from '@/lib/core/config/feature-flags'

/** Canonical base URL for the public-facing marketing site. No trailing slash. */
export const SITE_URL = 'https://www.sim.ai'

function hasHttpProtocol(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function normalizeBaseUrl(url: string): string {
  if (hasHttpProtocol(url)) {
    return url
  }

  const protocol = isProd ? 'https://' : 'http://'
  return `${protocol}${url}`
}

/**
 * Returns the base URL of the application from NEXT_PUBLIC_APP_URL
 * This ensures webhooks, callbacks, and other integrations always use the correct public URL
 * @returns The base URL string (e.g., 'http://localhost:3000' or 'https://example.com')
 * @throws Error if NEXT_PUBLIC_APP_URL is not configured
 */
export function getBaseUrl(): string {
  const baseUrl = getEnv('NEXT_PUBLIC_APP_URL')?.trim()

  if (!baseUrl) {
    throw new Error(
      'NEXT_PUBLIC_APP_URL must be configured for webhooks and callbacks to work correctly'
    )
  }

  return normalizeBaseUrl(baseUrl)
}

/**
 * Returns the base URL used by server-side internal API calls.
 * Falls back to NEXT_PUBLIC_APP_URL when INTERNAL_API_BASE_URL is not set.
 */
export function getInternalApiBaseUrl(): string {
  const internalBaseUrl = getEnv('INTERNAL_API_BASE_URL')?.trim()
  if (!internalBaseUrl) {
    return getBaseUrl()
  }

  if (!hasHttpProtocol(internalBaseUrl)) {
    throw new Error(
      'INTERNAL_API_BASE_URL must include protocol (http:// or https://), e.g. http://sim-app.default.svc.cluster.local:3000'
    )
  }

  return internalBaseUrl
}

/**
 * Ensures a URL is absolute by prefixing the base URL when a relative path is provided.
 * @param pathOrUrl - Relative path (e.g., /api/files/serve/...) or absolute URL
 */
export function ensureAbsoluteUrl(pathOrUrl: string): string {
  if (!pathOrUrl) {
    throw new Error('URL is required')
  }

  if (pathOrUrl.startsWith('/')) {
    return `${getBaseUrl()}${pathOrUrl}`
  }

  return pathOrUrl
}

/**
 * Returns just the domain and port part of the application URL
 * @returns The domain with port if applicable (e.g., 'localhost:3000' or 'sim.ai')
 */
export function getBaseDomain(): string {
  try {
    const url = new URL(getBaseUrl())
    return url.host // host includes port if specified
  } catch (_e) {
    const fallbackUrl = getEnv('NEXT_PUBLIC_APP_URL') || 'http://localhost:3000'
    try {
      return new URL(fallbackUrl).host
    } catch {
      return isProd ? 'sim.ai' : 'localhost:3000'
    }
  }
}

/**
 * Returns the domain for email addresses, stripping www subdomain for Resend compatibility
 * @returns The email domain (e.g., 'sim.ai' instead of 'www.sim.ai')
 */
export function getEmailDomain(): string {
  try {
    const baseDomain = getBaseDomain()
    return baseDomain.startsWith('www.') ? baseDomain.substring(4) : baseDomain
  } catch (_e) {
    return isProd ? 'sim.ai' : 'localhost:3000'
  }
}

const DEFAULT_SOCKET_URL = 'http://localhost:3002'
const DEFAULT_OLLAMA_URL = 'http://localhost:11434'
const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * Parses a comma-separated list of origins (e.g. from a `TRUSTED_ORIGINS` env
 * var) into a deduped array of normalized origins. Invalid entries are dropped.
 *
 * @param raw - Comma-separated origin list, or undefined/empty
 * @param onInvalid - Optional callback invoked once per invalid entry
 */
export function parseOriginList(
  raw: string | undefined | null,
  onInvalid?: (value: string) => void
): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  const origins: string[] = []
  for (const candidate of raw.split(',')) {
    const trimmed = candidate.trim()
    if (!trimmed) continue
    try {
      const { origin } = new URL(trimmed)
      if (!seen.has(origin)) {
        seen.add(origin)
        origins.push(origin)
      }
    } catch {
      onInvalid?.(trimmed)
    }
  }
  return origins
}

/**
 * Returns true when the given URL points at a localhost loopback host.
 * Used to detect misconfigured deployments where `NEXT_PUBLIC_APP_URL` is left
 * at its development default in production.
 */
export function isLocalhostUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return LOCALHOST_HOSTNAMES.has(hostname)
  } catch {
    return false
  }
}

/**
 * Returns the current browser origin, or `null` when called server-side.
 *
 * Use this when an absolute URL is needed for a same-origin resource (auth API,
 * reverse-proxied socket, etc.) so a misconfigured `NEXT_PUBLIC_*` env var
 * baked into the client bundle at build time can't pin requests to the wrong host.
 */
export function getBrowserOrigin(): string | null {
  return typeof window !== 'undefined' ? window.location.origin : null
}

/**
 * Returns the socket server URL for server-side internal API calls.
 * Reads from SOCKET_SERVER_URL with a localhost fallback for development.
 */
export function getSocketServerUrl(): string {
  return env.SOCKET_SERVER_URL || DEFAULT_SOCKET_URL
}

/**
 * Returns the socket server URL for client-side Socket.IO connections.
 *
 * Resolution order:
 * 1. `NEXT_PUBLIC_SOCKET_URL` if explicitly set (subdomain, separate host:port)
 * 2. In the browser when the page is served from a non-localhost origin, the
 *    page's own origin — assumes the reverse proxy routes `/socket.io` to the
 *    realtime service. This avoids shipping a hardcoded `localhost:3002` to
 *    self-hosters behind nginx/Cloudflare.
 * 3. `http://localhost:3002` for local development and SSR.
 */
export function getSocketUrl(): string {
  const explicit = getEnv('NEXT_PUBLIC_SOCKET_URL')?.trim()
  if (explicit) return explicit

  const browserOrigin = getBrowserOrigin()
  if (browserOrigin && !LOCALHOST_HOSTNAMES.has(new URL(browserOrigin).hostname)) {
    return browserOrigin
  }

  return DEFAULT_SOCKET_URL
}

/**
 * Returns the Ollama server URL.
 * Reads from OLLAMA_URL with a localhost fallback for development.
 */
export function getOllamaUrl(): string {
  return env.OLLAMA_URL || DEFAULT_OLLAMA_URL
}
