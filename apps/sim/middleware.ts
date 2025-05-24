import { NextRequest, NextResponse } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'
import { createLogger } from '@/lib/logs/console-logger'
import { getBaseDomain } from '@/lib/urls/utils'
import { env } from './lib/env'
import { verifyToken } from './lib/waitlist/token'

const logger = createLogger('Middleware')

// Environment flag to check if we're in development mode
const isDevelopment = env.NODE_ENV === 'development'

const SUSPICIOUS_UA_PATTERNS = [
  /^\s*$/, // Empty user agents
  /\.\./, // Path traversal attempt
  /<\s*script/i, // Potential XSS payloads
  /^\(\)\s*{/, // Command execution attempt
  /\b(sqlmap|nikto|gobuster|dirb|nmap)\b/i, // Known scanning tools
]

const BASE_DOMAIN = getBaseDomain()

export async function middleware(request: NextRequest) {
  // Check for active session
  const sessionCookie = getSessionCookie(request)
  const hasActiveSession = !!sessionCookie

  // Check if user has previously logged in by checking localStorage value in cookies
  const hasPreviouslyLoggedIn = request.cookies.get('has_logged_in_before')?.value === 'true'

  const url = request.nextUrl
  const hostname = request.headers.get('host') || ''

  // Extract subdomain
  const isCustomDomain =
    hostname !== BASE_DOMAIN &&
    !hostname.startsWith('www.') &&
    hostname.includes(isDevelopment ? 'localhost' : 'simstudio.ai')
  const subdomain = isCustomDomain ? hostname.split('.')[0] : null

  // Handle chat subdomains
  if (subdomain && isCustomDomain) {
    // Special case for API requests from the subdomain
    if (url.pathname.startsWith('/api/chat/')) {
      // Already an API request, let it go through
      return NextResponse.next()
    }

    // Rewrite to the chat page but preserve the URL in browser
    return NextResponse.rewrite(new URL(`/chat/${subdomain}${url.pathname}`, request.url))
  }

  // Check if the path is exactly /w
  if (url.pathname === '/w') {
    return NextResponse.redirect(new URL('/w/1', request.url))
  }

  // Handle protected routes that require authentication
  if (url.pathname.startsWith('/w/') || url.pathname === '/w') {
    if (!hasActiveSession) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return NextResponse.next()
  }

  // Allow access to invitation links
  if (request.nextUrl.pathname.startsWith('/invite/')) {
    if (
      !hasActiveSession &&
      !request.nextUrl.pathname.endsWith('/login') &&
      !request.nextUrl.pathname.endsWith('/signup') &&
      !request.nextUrl.search.includes('callbackUrl')
    ) {
      const token = request.nextUrl.searchParams.get('token')
      const inviteId = request.nextUrl.pathname.split('/').pop()
      const callbackParam = encodeURIComponent(
        `/invite/${inviteId}${token ? `?token=${token}` : ''}`
      )
      return NextResponse.redirect(
        new URL(`/login?callbackUrl=${callbackParam}&invite_flow=true`, request.url)
      )
    }
    return NextResponse.next()
  }

  // Allow access to workspace invitation API endpoint
  if (request.nextUrl.pathname.startsWith('/api/workspaces/invitations')) {
    if (request.nextUrl.pathname.includes('/accept') && !hasActiveSession) {
      const token = request.nextUrl.searchParams.get('token')
      if (token) {
        return NextResponse.redirect(new URL(`/invite/${token}?token=${token}`, request.url))
      }
    }
    return NextResponse.next()
  }

  // If self-hosted skip waitlist
  if (env.DOCKER_BUILD) {
    return NextResponse.next()
  }

  // Skip waitlist protection for development environment
  if (isDevelopment) {
    return NextResponse.next()
  }

  const userAgent = request.headers.get('user-agent') || ''
  const isSuspicious = SUSPICIOUS_UA_PATTERNS.some((pattern) => pattern.test(userAgent))
  if (isSuspicious) {
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

  const response = NextResponse.next()
  response.headers.set('Vary', 'User-Agent')
  return response
}

// Update matcher to include invitation routes
export const config = {
  matcher: [
    '/w', // Match exactly /w
    '/w/:path*', // Match protected routes
    '/login',
    '/signup',
    '/invite/:path*', // Match invitation routes
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
