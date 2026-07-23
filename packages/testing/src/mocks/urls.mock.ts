import { vi } from 'vitest'
import { envMockFns, mockEnvObject } from './env.mock'
import { envFlagsMock } from './env-flags.mock'

/** Mirrors the real `LOCALHOST_HOSTNAMES` from `@/lib/core/utils/urls`. */
export const LOCALHOST_HOSTNAMES_MOCK: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  '::1',
])

const DEFAULT_SOCKET_URL = 'http://localhost:3002'
const DEFAULT_OLLAMA_URL = 'http://localhost:11434'

function readEnv(key: string): string | undefined {
  return envMockFns.getEnv(key)
}

function hasHttpProtocol(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function getBaseUrlImpl(): string {
  const baseUrl = readEnv('NEXT_PUBLIC_APP_URL')?.trim()
  if (!baseUrl) {
    throw new Error(
      'NEXT_PUBLIC_APP_URL must be configured for webhooks and callbacks to work correctly'
    )
  }
  // Mirrors the real module: protocol-less values get https:// under isProd.
  const protocol = envFlagsMock.isProd ? 'https://' : 'http://'
  return hasHttpProtocol(baseUrl) ? baseUrl : `${protocol}${baseUrl}`
}

function getInternalApiBaseUrlImpl(): string {
  const internalBaseUrl = readEnv('INTERNAL_API_BASE_URL')?.trim()
  if (!internalBaseUrl) return getBaseUrlImpl()
  if (!hasHttpProtocol(internalBaseUrl)) {
    throw new Error(
      'INTERNAL_API_BASE_URL must include protocol (http:// or https://), e.g. http://sim-app.default.svc.cluster.local:3000'
    )
  }
  return internalBaseUrl
}

function ensureAbsoluteUrlImpl(pathOrUrl: string): string {
  if (!pathOrUrl) throw new Error('URL is required')
  return pathOrUrl.startsWith('/') ? `${getBaseUrlImpl()}${pathOrUrl}` : pathOrUrl
}

function getBaseDomainImpl(): string {
  try {
    return new URL(getBaseUrlImpl()).host
  } catch {
    const fallbackUrl = readEnv('NEXT_PUBLIC_APP_URL') || 'http://localhost:3000'
    try {
      return new URL(fallbackUrl).host
    } catch {
      // Mirrors the real module's unparseable-URL fallback per environment.
      return envFlagsMock.isProd ? 'sim.ai' : 'localhost:3000'
    }
  }
}

function getEmailDomainImpl(): string {
  const baseDomain = getBaseDomainImpl()
  return baseDomain.startsWith('www.') ? baseDomain.substring(4) : baseDomain
}

function isLoopbackHostnameImpl(hostname: string): boolean {
  return LOCALHOST_HOSTNAMES_MOCK.has(hostname)
}

function parseOriginListImpl(
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

function isLocalhostUrlImpl(url: string): boolean {
  try {
    return LOCALHOST_HOSTNAMES_MOCK.has(new URL(url).hostname)
  } catch {
    return false
  }
}

function getBrowserOriginImpl(): string | null {
  return typeof window !== 'undefined' ? window.location.origin : null
}

function isSafeHttpUrlImpl(url: string): boolean {
  try {
    const parsed = new URL(url, getBrowserOriginImpl() ?? undefined)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function getSocketServerUrlImpl(): string {
  const value = mockEnvObject.SOCKET_SERVER_URL
  return (typeof value === 'string' && value) || DEFAULT_SOCKET_URL
}

function getSocketUrlImpl(): string {
  const explicit = readEnv('NEXT_PUBLIC_SOCKET_URL')?.trim()
  if (explicit) return explicit
  const browserOrigin = getBrowserOriginImpl()
  if (browserOrigin && !LOCALHOST_HOSTNAMES_MOCK.has(new URL(browserOrigin).hostname)) {
    return browserOrigin
  }
  return DEFAULT_SOCKET_URL
}

function getOllamaUrlImpl(): string {
  const value = mockEnvObject.OLLAMA_URL
  return (typeof value === 'string' && value) || DEFAULT_OLLAMA_URL
}

/**
 * Controllable mock functions for `@/lib/core/utils/urls`. Each defaults to a
 * faithful implementation of the real module that reads through the shared env
 * mock (so `setEnv({ NEXT_PUBLIC_APP_URL: ... })` changes the derived URLs).
 * Override per-test and restore with {@link resetUrlsMock}.
 *
 * @example
 * ```ts
 * import { urlsMockFns } from '@sim/testing'
 *
 * urlsMockFns.mockGetBaseUrl.mockReturnValue('https://custom.example.com')
 * ```
 */
export const urlsMockFns = {
  mockGetBaseUrl: vi.fn(getBaseUrlImpl),
  mockGetInternalApiBaseUrl: vi.fn(getInternalApiBaseUrlImpl),
  mockEnsureAbsoluteUrl: vi.fn(ensureAbsoluteUrlImpl),
  mockGetBaseDomain: vi.fn(getBaseDomainImpl),
  mockGetEmailDomain: vi.fn(getEmailDomainImpl),
  mockIsLoopbackHostname: vi.fn(isLoopbackHostnameImpl),
  mockParseOriginList: vi.fn(parseOriginListImpl),
  mockIsLocalhostUrl: vi.fn(isLocalhostUrlImpl),
  mockGetBrowserOrigin: vi.fn(getBrowserOriginImpl),
  mockIsSafeHttpUrl: vi.fn(isSafeHttpUrlImpl),
  mockGetSocketServerUrl: vi.fn(getSocketServerUrlImpl),
  mockGetSocketUrl: vi.fn(getSocketUrlImpl),
  mockGetOllamaUrl: vi.fn(getOllamaUrlImpl),
}

/**
 * Restores every urls mock function to its default (real-behavior)
 * implementation.
 */
export function resetUrlsMock(): void {
  urlsMockFns.mockGetBaseUrl.mockReset().mockImplementation(getBaseUrlImpl)
  urlsMockFns.mockGetInternalApiBaseUrl.mockReset().mockImplementation(getInternalApiBaseUrlImpl)
  urlsMockFns.mockEnsureAbsoluteUrl.mockReset().mockImplementation(ensureAbsoluteUrlImpl)
  urlsMockFns.mockGetBaseDomain.mockReset().mockImplementation(getBaseDomainImpl)
  urlsMockFns.mockGetEmailDomain.mockReset().mockImplementation(getEmailDomainImpl)
  urlsMockFns.mockIsLoopbackHostname.mockReset().mockImplementation(isLoopbackHostnameImpl)
  urlsMockFns.mockParseOriginList.mockReset().mockImplementation(parseOriginListImpl)
  urlsMockFns.mockIsLocalhostUrl.mockReset().mockImplementation(isLocalhostUrlImpl)
  urlsMockFns.mockGetBrowserOrigin.mockReset().mockImplementation(getBrowserOriginImpl)
  urlsMockFns.mockIsSafeHttpUrl.mockReset().mockImplementation(isSafeHttpUrlImpl)
  urlsMockFns.mockGetSocketServerUrl.mockReset().mockImplementation(getSocketServerUrlImpl)
  urlsMockFns.mockGetSocketUrl.mockReset().mockImplementation(getSocketUrlImpl)
  urlsMockFns.mockGetOllamaUrl.mockReset().mockImplementation(getOllamaUrlImpl)
}

/**
 * Complete mock module for `@/lib/core/utils/urls`, installed globally in
 * `apps/sim/vitest.setup.ts`. Every export of the real module is present.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/utils/urls', () => urlsMock)
 * ```
 */
export const urlsMock = {
  SITE_URL: 'https://www.sim.ai',
  LOCALHOST_HOSTNAMES: LOCALHOST_HOSTNAMES_MOCK,
  getBaseUrl: urlsMockFns.mockGetBaseUrl,
  getInternalApiBaseUrl: urlsMockFns.mockGetInternalApiBaseUrl,
  ensureAbsoluteUrl: urlsMockFns.mockEnsureAbsoluteUrl,
  getBaseDomain: urlsMockFns.mockGetBaseDomain,
  getEmailDomain: urlsMockFns.mockGetEmailDomain,
  isLoopbackHostname: urlsMockFns.mockIsLoopbackHostname,
  parseOriginList: urlsMockFns.mockParseOriginList,
  isLocalhostUrl: urlsMockFns.mockIsLocalhostUrl,
  getBrowserOrigin: urlsMockFns.mockGetBrowserOrigin,
  isSafeHttpUrl: urlsMockFns.mockIsSafeHttpUrl,
  getSocketServerUrl: urlsMockFns.mockGetSocketServerUrl,
  getSocketUrl: urlsMockFns.mockGetSocketUrl,
  getOllamaUrl: urlsMockFns.mockGetOllamaUrl,
}
