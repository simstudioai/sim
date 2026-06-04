import { createLogger } from '@sim/logger'
import { getSessionCookie } from 'better-auth/cookies'
import { type NextRequest, NextResponse } from 'next/server'
import { sendToProfound } from './lib/analytics/profound'
import { getEnv } from './lib/core/config/env'
import { isAuthDisabled, isHosted } from './lib/core/config/feature-flags'
import { generateRuntimeCSP } from './lib/core/security/csp'
import { getClientIp } from './lib/core/utils/request'

const logger = createLogger('Proxy')

export interface CorsPolicy {
  origin: string
  credentials: boolean
  methods: string
  headers: string
}

const DEFAULT_API_ALLOWED_HEADERS =
  'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-API-Key, Authorization'

const WORKFLOW_EXECUTE_HEADERS =
  'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-API-Key'

/** Subpaths under /api/{chat,form}/* that serve the workspace UI, not embeds. */
const EMBED_RESERVED_SEGMENTS = new Set(['manage', 'validate'])

/** True for /api/{chat,form}/[identifier] and any deeper subroute. */
function isEmbedPath(pathname: string): boolean {
  const segments = pathname.split('/')
  if (segments.length < 4) return false
  if (segments[1] !== 'api') return false
  if (segments[2] !== 'chat' && segments[2] !== 'form') return false
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
]

/** Single source of truth for /api/* CORS — resolved at request time, not baked at build. */
export function resolveApiCorsPolicy(request: NextRequest): CorsPolicy {
  const { pathname } = request.nextUrl
  for (const rule of CORS_RULES) {
    if (rule.match(pathname)) return rule.policy(request)
  }
  return {
    origin: getEnv('NEXT_PUBLIC_APP_URL') || 'http://localhost:3001',
    credentials: true,
    methods: 'GET,POST,OPTIONS,PUT,DELETE',
    headers: DEFAULT_API_ALLOWED_HEADERS,
  }
}

const CORS_PREFLIGHT_MAX_AGE = '86400'

function applyCorsHeaders(response: NextResponse, policy: CorsPolicy): void {
  response.headers.set('Access-Control-Allow-Origin', policy.origin)
  response.headers.set('Access-Control-Allow-Credentials', String(policy.credentials))
  response.headers.set('Access-Control-Allow-Methods', policy.methods)
  response.headers.set('Access-Control-Allow-Headers', policy.headers)
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

  if (!isHosted) {
    // Self-hosted: Always redirect based on session
    if (hasActiveSession) {
      return NextResponse.redirect(new URL('/workspace', request.url))
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // For root path, redirect authenticated users to workspace
  // Unless they have a 'home' query parameter (e.g., ?home)
  // This allows intentional navigation to the homepage from anywhere in the app
  if (hasActiveSession) {
    const isBrowsingHome = url.searchParams.has('home')
    if (!isBrowsingHome) {
      return NextResponse.redirect(new URL('/workspace', request.url))
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
  return NextResponse.next()
}

/**
 * Handles security filtering for suspicious user agents
 */
function handleSecurityFiltering(request: NextRequest): NextResponse | null {
  const userAgent = request.headers.get('user-agent') || ''
  const { pathname } = request.nextUrl
  const isWebhookEndpoint = pathname.startsWith('/api/webhooks/trigger/')
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

export async function proxy(request: NextRequest) {
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
  if (redirect) return track(request, redirect)

  if (url.pathname === '/login' || url.pathname === '/signup') {
    if (hasActiveSession) {
      return track(request, NextResponse.redirect(new URL('/workspace', request.url)))
    }
    const response = NextResponse.next()
    response.headers.set('Content-Security-Policy', generateRuntimeCSP())
    response.headers.set('X-Content-Type-Options', 'nosniff')
    response.headers.set('X-Frame-Options', 'SAMEORIGIN')
    return track(request, response)
  }

  // Chat pages are publicly accessible embeds — CSP is set in next.config.ts headers
  if (url.pathname.startsWith('/chat/')) {
    return track(request, NextResponse.next())
  }

  // Allow public access to template pages for SEO
  if (url.pathname.startsWith('/templates')) {
    return track(request, NextResponse.next())
  }

  if (url.pathname.startsWith('/workspace')) {
    // Allow public access to workspace template pages - they handle their own redirects
    if (url.pathname.match(/^\/workspace\/[^/]+\/templates/)) {
      return track(request, NextResponse.next())
    }

    if (!hasActiveSession) {
      return track(request, NextResponse.redirect(new URL('/login', request.url)))
    }
    const response = NextResponse.next()
    response.headers.set('Content-Security-Policy', generateRuntimeCSP())
    response.headers.set('X-Content-Type-Options', 'nosniff')
    response.headers.set('X-Frame-Options', 'SAMEORIGIN')
    return track(request, response)
  }

  const invitationRedirect = handleInvitationRedirects(request, hasActiveSession)
  if (invitationRedirect) return track(request, invitationRedirect)

  const securityBlock = handleSecurityFiltering(request)
  if (securityBlock) return track(request, securityBlock)

  const response = NextResponse.next()
  response.headers.set('Vary', 'User-Agent')

  if (url.pathname === '/') {
    response.headers.set('Content-Security-Policy', generateRuntimeCSP())
    response.headers.set('X-Content-Type-Options', 'nosniff')
    response.headers.set('X-Frame-Options', 'SAMEORIGIN')
  }

  return track(request, response)
}

/**
 * Sends request data to Profound analytics (fire-and-forget) and returns the response.
 */
function track(request: NextRequest, response: NextResponse): NextResponse {
  sendToProfound(request, response.status)
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
    '/login',
    '/signup',
    '/invite/:path*', // Match invitation routes
    '/api/:path*', // Runtime CORS
    // Catch-all for other pages, excluding static assets and public directories
    '/((?!api/|api$|_next/static|_next/image|ingest|favicon.ico|logo/|static/|footer/|social/|enterprise/|favicon/|twitter/|robots.txt|sitemap.xml).*)',
  ],
}
