import { getSessionCookie } from 'better-auth/cookies'
import { type NextRequest, NextResponse } from 'next/server'
import { isHosted } from './lib/environment'
import { createLogger } from './lib/logs/console/logger'
import { generateRuntimeCSP } from './lib/security/csp'

const logger = createLogger('Middleware')

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

  if (url.pathname !== '/' && url.pathname !== '/homepage') {
    return null
  }

  if (!isHosted) {
    // Self-hosted: Always redirect based on session
    if (hasActiveSession) {
      return NextResponse.redirect(new URL('/workspace', request.url))
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Hosted: Allow access to /homepage route even for authenticated users
  if (url.pathname === '/homepage') {
    return NextResponse.rewrite(new URL('/', request.url))
  }

  // For root path, redirect authenticated users to workspace
  if (hasActiveSession && url.pathname === '/') {
    return NextResponse.redirect(new URL('/workspace', request.url))
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
 * Handles workspace invitation API endpoint access
 */
function handleWorkspaceInvitationAPI(
  request: NextRequest,
  hasActiveSession: boolean
): NextResponse | null {
  if (!request.nextUrl.pathname.startsWith('/api/workspaces/invitations')) {
    return null
  }

  if (request.nextUrl.pathname.includes('/accept') && !hasActiveSession) {
    const token = request.nextUrl.searchParams.get('token')
    if (token) {
      return NextResponse.redirect(new URL(`/invite/${token}?token=${token}`, request.url))
    }
  }
  return NextResponse.next()
}

/**
 * Handles security filtering for suspicious user agents
 */
function handleSecurityFiltering(request: NextRequest): NextResponse | null {
  const userAgent = request.headers.get('user-agent') || ''
  const isWebhookEndpoint = request.nextUrl.pathname.startsWith('/api/webhooks/trigger/')
  const isSuspicious = SUSPICIOUS_UA_PATTERNS.some((pattern) => pattern.test(userAgent))

  // Block suspicious requests, but exempt webhook endpoints from User-Agent validation
  if (isSuspicious && !isWebhookEndpoint) {
    logger.warn('Blocked suspicious request', {
      userAgent,
      ip: request.headers.get('x-forwarded-for') || 'unknown',
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

export async function middleware(request: NextRequest) {
  const url = request.nextUrl

  const sessionCookie = getSessionCookie(request)
  const hasActiveSession = !!sessionCookie

  const redirect = handleRootPathRedirects(request, hasActiveSession)
  if (redirect) return redirect

  if (url.pathname === '/login' || url.pathname === '/signup') {
    if (hasActiveSession) {
      return NextResponse.redirect(new URL('/workspace', request.url))
    }
    return NextResponse.next()
  }

  if (url.pathname.startsWith('/chat/')) {
    return NextResponse.next()
  }

  if (url.pathname.startsWith('/workspace')) {
    if (!hasActiveSession) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return NextResponse.next()
  }

  const invitationRedirect = handleInvitationRedirects(request, hasActiveSession)
  if (invitationRedirect) return invitationRedirect

  const workspaceInvitationRedirect = handleWorkspaceInvitationAPI(request, hasActiveSession)
  if (workspaceInvitationRedirect) return workspaceInvitationRedirect

  const securityBlock = handleSecurityFiltering(request)
  if (securityBlock) return securityBlock

  const response = NextResponse.next()
  response.headers.set('Vary', 'User-Agent')

  if (
    url.pathname.startsWith('/workspace') ||
    url.pathname.startsWith('/chat') ||
    url.pathname === '/'
  ) {
    response.headers.set('Content-Security-Policy', generateRuntimeCSP())
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
    '/login',
    '/signup',
    '/invite/:path*', // Match invitation routes
    // Catch-all for other pages, excluding static assets and public directories
    '/((?!_next/static|_next/image|favicon.ico|logo/|static/|footer/|social/|enterprise/|favicon/|twitter/|robots.txt|sitemap.xml).*)',
  ],
}
