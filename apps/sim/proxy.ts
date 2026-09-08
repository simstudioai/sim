import { createLogger } from '@sim/logger'
import { getSessionCookie } from 'better-auth/cookies'
import { type NextRequest, NextResponse } from 'next/server'
import { APP_ENTRY_PATH, isAppSurfacePath } from '@/lib/navigation/paths'
import { isOAuthAuthorizationCallback, resolveAuthRedirect } from '@/app/(auth)/auth-redirect'
import { getEnv } from './lib/core/config/env'
import { isAuthDisabled, isDev, isHosted } from './lib/core/config/env-flags'
import { generateRuntimeCSP } from './lib/core/security/csp'
import { getClientIp } from './lib/core/utils/request'
import { isNonCanonicalSimHost } from './lib/core/utils/urls'

const logger = createLogger('Proxy')

export interface CorsPolicy {
  origin: string
  credentials: boolean
  methods: string
  headers: string
  /** Response headers a browser client may read; omitted leaves the CORS default. */
  exposeHeaders?: string
}

/**
 * Every method the `/api` surface actually answers, for the default CORS policy.
 *
 * Hand-written rather than derived from the contract registry because this
 * module is edge middleware: importing `lib/api/contracts` would pull Zod and
 * the whole contract tree into the middleware bundle. Nothing enforces the
 * correspondence — the per-route `CORS_RULES` entries below are unenforced the
 * same way — so a contract that introduces a new method must add it here in the
 * same change. This list previously omitted `PATCH` while 17 v2 operations used
 * it, so a browser preflight for any of them failed.
 *
 * `HEAD` is included because Next answers it from each route's `GET` handler,
 * which the route builders permit via `methodMatchesContract`.
 */
const DEFAULT_API_ALLOWED_METHODS = 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS'

/**
 * Response headers the `/api` surface sets that a browser client must be able to read.
 *
 * Without `Access-Control-Expose-Headers` a browser can read only the six
 * CORS-safelisted response headers, so everything here is on the wire but
 * invisible to `fetch()` — the rate-limit budget, the retry delay a 429 or 503
 * asks the caller to observe, and the ids needed to correlate a run or a support
 * report. Server-to-server callers are unaffected, which is why the gap is easy
 * to miss.
 */
const DEFAULT_API_EXPOSED_HEADERS =
  'Retry-After, WWW-Authenticate, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Request-Id, X-Run-Id'

const DEFAULT_API_ALLOWED_HEADERS =
  'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-API-Key, Authorization'

const WORKFLOW_EXECUTE_HEADERS =
  'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-API-Key, Authorization, X-Execution-Id, X-Execution-Mode, X-Execution-Timeout-Seconds'

/** v2 execute: run identity and modes use the v2 wire names while streaming negotiates its protocol. */
const WORKFLOW_EXECUTE_V2_HEADERS =
  'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-API-Key, Authorization, X-Run-Id, X-Sim-Stream-Protocol'

/** Subpaths under /api/chat/* that serve the workspace UI, not embeds. */
const EMBED_RESERVED_SEGMENTS = new Set(['manage', 'validate'])

/** True for /api/chat/[identifier] and any deeper subroute. */
function isEmbedPath(pathname: string): boolean {
  const segments = pathname.split('/')
  if (segments.length < 4) return false
  if (segments[1] !== 'api') return false
  if (segments[2] !== 'chat') return false
  const identifier = segments[3]
  if (!identifier || EMBED_RESERVED_SEGMENTS.has(identifier)) return false
  return true
}

interface CorsRule {
  match: (pathname: string) => boolean
  policy: (request: NextRequest) => CorsPolicy
}

const CORS_RULES: readonly CorsRule[] = [
  {
    match: (p) => p.startsWith('/api/auth/oauth2/'),
    policy: () => ({
      origin: '*',
      credentials: false,
      methods: 'GET, POST, OPTIONS',
      headers: 'Content-Type, Authorization, Accept',
    }),
  },
  {
    match: (p) => p.startsWith('/api/auth/.well-known/'),
    policy: () => ({
      origin: '*',
      credentials: false,
      methods: 'GET, OPTIONS',
      headers: 'Content-Type, Accept',
    }),
  },
  {
    match: (p) => p === '/api/mcp/copilot',
    policy: () => ({
      origin: '*',
      credentials: false,
      methods: 'GET, POST, OPTIONS, DELETE',
      headers: 'Content-Type, Authorization, X-API-Key, X-Requested-With, Accept',
    }),
  },
  {
    match: (p) => isEmbedPath(p),
    policy: (request) => {
      const requestOrigin = request.headers.get('origin')
      return {
        origin: requestOrigin || '*',
        credentials: !!requestOrigin,
        methods: 'GET, POST, PUT, OPTIONS',
        headers: 'Content-Type, X-Requested-With',
      }
    },
  },
  {
    match: (p) => /^\/api\/workflows\/[^/]+\/execute$/.test(p),
    policy: () => ({
      origin: '*',
      credentials: false,
      methods: 'GET,POST,OPTIONS,PUT',
      headers: WORKFLOW_EXECUTE_HEADERS,
    }),
  },
  {
    // Mirrors the v1 rule: public execute endpoints are wildcard-origin and
    // credential-free — the default credentialed policy would both block
    // browser API-key calls and open a cookie-bearing CSRF surface.
    match: (p) => /^\/api\/v2\/workflows\/[^/]+\/execute$/.test(p),
    policy: () => ({
      origin: '*',
      credentials: false,
      methods: 'POST,OPTIONS',
      headers: WORKFLOW_EXECUTE_V2_HEADERS,
    }),
  },
]

/**
 * Single source of truth for /api/* CORS — resolved at request time, not baked at build.
 *
 * The exposed-header list is applied to every policy, matched rule or fallback,
 * because the headers it names are set by the same shared route machinery on
 * every route. A rule opts out by spelling `exposeHeaders: undefined`; carrying
 * the list per rule instead is how `/api/v2/workflows/{workflowId}/execute` — the only
 * route that emits `X-Run-Id`, and wildcard-origin precisely so browsers can
 * call it — ended up unable to hand a browser the run id or a 429's
 * `Retry-After`.
 */
export function resolveApiCorsPolicy(request: NextRequest): CorsPolicy {
  const { pathname } = request.nextUrl
  for (const rule of CORS_RULES) {
    if (rule.match(pathname)) {
      return { exposeHeaders: DEFAULT_API_EXPOSED_HEADERS, ...rule.policy(request) }
    }
  }
  return {
    origin: getEnv('NEXT_PUBLIC_APP_URL') || 'http://localhost:3001',
    credentials: true,
    methods: DEFAULT_API_ALLOWED_METHODS,
    headers: DEFAULT_API_ALLOWED_HEADERS,
    exposeHeaders: DEFAULT_API_EXPOSED_HEADERS,
  }
}

const CORS_PREFLIGHT_MAX_AGE = '86400'

function applyCorsHeaders(response: NextResponse, policy: CorsPolicy): void {
  response.headers.set('Access-Control-Allow-Origin', policy.origin)
  response.headers.set('Access-Control-Allow-Credentials', String(policy.credentials))
  response.headers.set('Access-Control-Allow-Methods', policy.methods)
  response.headers.set('Access-Control-Allow-Headers', policy.headers)
  if (policy.exposeHeaders) {
    response.headers.set('Access-Control-Expose-Headers', policy.exposeHeaders)
  }
  if (policy.origin !== '*') {
    response.headers.set('Vary', 'Origin')
  }
}

/** Next's auto-OPTIONS doesn't carry middleware headers, so we answer preflight here. */
function buildPreflightResponse(policy: CorsPolicy): NextResponse {
  const response = new NextResponse(null, { status: 204 })
  applyCorsHeaders(response, policy)
  response.headers.set('Access-Control-Max-Age', CORS_PREFLIGHT_MAX_AGE)
  return response
}

const SUSPICIOUS_UA_PATTERNS = [
  /^\s*$/, // Empty user agents
  /\.\./, // Path traversal attempt
  /<\s*script/i, // Potential XSS payloads
  /^\(\)\s*{/, // Command execution attempt
  /\b(sqlmap|nikto|gobuster|dirb|nmap)\b/i, // Known scanning tools
] as const

/**
 * Handles authentication-based redirects for root paths
 */
function handleRootPathRedirects(
  request: NextRequest,
  hasActiveSession: boolean
): NextResponse | null {
  const url = request.nextUrl

  if (url.pathname !== '/') {
    return null
  }

  if (!isHosted && !isDev) {
    // Self-hosted production: Always redirect based on session.
    if (hasActiveSession) {
      return NextResponse.redirect(new URL(APP_ENTRY_PATH, request.url))
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // For root path, redirect authenticated users into the app
  // Unless they have a 'home' query parameter (e.g., ?home)
  // This allows intentional navigation to the homepage from anywhere in the app
  if (hasActiveSession) {
    const isBrowsingHome = url.searchParams.has('home')
    if (!isBrowsingHome) {
      return NextResponse.redirect(new URL(APP_ENTRY_PATH, request.url))
    }
  }

  return null
}

/**
 * Handles invitation link redirects for unauthenticated users
 */
function handleInvitationRedirects(
  request: NextRequest,
  hasActiveSession: boolean
): NextResponse | null {
  if (!request.nextUrl.pathname.startsWith('/invite/')) {
    return null
  }

  if (
    !hasActiveSession &&
    !request.nextUrl.pathname.endsWith('/login') &&
    !request.nextUrl.pathname.endsWith('/signup') &&
    !request.nextUrl.search.includes('callbackUrl')
  ) {
    const token = request.nextUrl.searchParams.get('token')
    const inviteId = request.nextUrl.pathname.split('/').pop()
    const callbackParam = encodeURIComponent(`/invite/${inviteId}${token ? `?token=${token}` : ''}`)
    return NextResponse.redirect(
      new URL(`/login?callbackUrl=${callbackParam}&invite_flow=true`, request.url)
    )
  }
  const response = NextResponse.next()
  response.headers.set('Content-Security-Policy', generateRuntimeCSP())
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'SAMEORIGIN')
  return response
}

/**
 * Handles security filtering for suspicious user agents
 */
function handleSecurityFiltering(request: NextRequest): NextResponse | null {
  const userAgent = request.headers.get('user-agent') || ''
  const { pathname } = request.nextUrl
  const isWebhookEndpoint =
    pathname.startsWith('/api/webhooks/trigger/') ||
    pathname.startsWith('/api/webhooks/tiktok') ||
    pathname.startsWith('/api/webhooks/agentmail')
  const isMcpEndpoint = pathname.startsWith('/api/mcp/')
  const isMcpOauthDiscoveryEndpoint =
    pathname.startsWith('/.well-known/oauth-authorization-server') ||
    pathname.startsWith('/.well-known/oauth-protected-resource')
  const isSuspicious = SUSPICIOUS_UA_PATTERNS.some((pattern) => pattern.test(userAgent))

  // Block suspicious requests, but exempt machine-to-machine endpoints that may
  // legitimately omit User-Agent headers (webhooks and MCP protocol discovery/calls).
  if (isSuspicious && !isWebhookEndpoint && !isMcpEndpoint && !isMcpOauthDiscoveryEndpoint) {
    logger.warn('Blocked suspicious request', {
      userAgent,
      ip: getClientIp(request),
      url: request.url,
      method: request.method,
      pattern: SUSPICIOUS_UA_PATTERNS.find((pattern) => pattern.test(userAgent))?.toString(),
    })

    return new NextResponse(null, {
      status: 403,
      statusText: 'Forbidden',
      headers: {
        'Content-Type': 'text/plain',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'none'",
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    })
  }

  return null
}

export function proxy(request: NextRequest) {
  const url = request.nextUrl

  if (url.pathname.startsWith('/api/')) {
    const policy = resolveApiCorsPolicy(request)
    if (request.method === 'OPTIONS') {
      return buildPreflightResponse(policy)
    }
    const response = NextResponse.next()
    applyCorsHeaders(response, policy)
    return response
  }

  const sessionCookie = getSessionCookie(request)
  const hasActiveSession = isAuthDisabled || !!sessionCookie

  const redirect = handleRootPathRedirects(request, hasActiveSession)
  if (redirect) return applyIndexingPolicy(request, redirect)

  if (url.pathname === '/login' || url.pathname === '/signup') {
    const { rawCallbackUrl } = resolveAuthRedirect({
      redirect: url.searchParams.get('redirect'),
      callbackUrl: url.searchParams.get('callbackUrl'),
      inviteFlow: url.searchParams.get('invite_flow'),
    })
    const isOAuthSignIn =
      isOAuthAuthorizationCallback(rawCallbackUrl, url.origin) && !isAuthDisabled
    if (hasActiveSession && !isOAuthSignIn) {
      return applyIndexingPolicy(
        request,
        NextResponse.redirect(new URL(APP_ENTRY_PATH, request.url))
      )
    }
    const response = NextResponse.next()
    response.headers.set('Content-Security-Policy', generateRuntimeCSP())
    response.headers.set('X-Content-Type-Options', 'nosniff')
    response.headers.set('X-Frame-Options', 'SAMEORIGIN')
    return applyIndexingPolicy(request, response)
  }

  // Chat pages are publicly accessible embeds — CSP is set in next.config.ts headers
  if (url.pathname.startsWith('/chat/')) {
    return applyIndexingPolicy(request, NextResponse.next())
  }

  if (isAppSurfacePath(url.pathname)) {
    if (!hasActiveSession) {
      return applyIndexingPolicy(request, NextResponse.redirect(new URL('/login', request.url)))
    }
    const response = NextResponse.next()
    response.headers.set('Content-Security-Policy', generateRuntimeCSP())
    response.headers.set('X-Content-Type-Options', 'nosniff')
    response.headers.set('X-Frame-Options', 'SAMEORIGIN')
    return applyIndexingPolicy(request, response)
  }

  const invitationRedirect = handleInvitationRedirects(request, hasActiveSession)
  if (invitationRedirect) return applyIndexingPolicy(request, invitationRedirect)

  const securityBlock = handleSecurityFiltering(request)
  if (securityBlock) return applyIndexingPolicy(request, securityBlock)

  const response = NextResponse.next()
  response.headers.set('Vary', 'User-Agent')

  response.headers.set('Content-Security-Policy', generateRuntimeCSP())
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'SAMEORIGIN')

  return applyIndexingPolicy(request, response)
}

/**
 * Keeps non-production sim.ai deployments out of search results.
 *
 * `noindex` rather than a robots.txt `Disallow` is deliberate: a disallowed URL
 * can still be indexed when linked externally, and blocking the crawl stops
 * search engines from ever seeing the directive that removes pages already in
 * the index. robots.txt is excluded from this proxy's matcher so it keeps
 * serving the crawlable rules this header depends on.
 */
function applyIndexingPolicy(request: NextRequest, response: NextResponse): NextResponse {
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    request.headers.get('host') ||
    request.nextUrl.host

  if (isNonCanonicalSimHost(host)) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  }

  return response
}

export const config = {
  matcher: [
    '/', // Root path for self-hosted redirect logic
    '/terms', // Whitelabel terms redirect
    '/privacy', // Whitelabel privacy redirect
    '/w', // Legacy /w redirect
    '/w/:path*', // Legacy /w/* redirects
    '/workspace/:path*', // New workspace routes
    '/home', // App entry
    '/o', // Organization surface
    '/o/:path*',
    '/login',
    '/signup',
    '/invite/:path*', // Match invitation routes
    '/api/:path*', // Runtime CORS
    // Catch-all for other pages, excluding static assets and public directories
    '/((?!api/|api$|_next/static|_next/image|ingest|favicon.ico|logo/|landing/|static/|footer/|social/|enterprise/|favicon/|twitter/|robots.txt|sitemap.xml).*)',
  ],
}
