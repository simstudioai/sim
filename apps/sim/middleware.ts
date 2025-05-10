import { NextRequest, NextResponse } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'
import { createLogger } from '@/lib/logs/console-logger'
import { getBaseDomain } from '@/lib/urls/utils'
import { verifyToken } from './lib/waitlist/token'

const logger = createLogger('Middleware')

// Environment flag to check if we're in development mode
const isDevelopment = process.env.NODE_ENV === 'development'

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

  // Allow access to invitation links
  if (request.nextUrl.pathname.startsWith('/invite/')) {
    return NextResponse.next()
  }

  // Handle protected routes that require authentication
  if (url.pathname.startsWith('/w/') || url.pathname === '/w') {
    if (!hasActiveSession) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return NextResponse.next()
  }

  // Skip waitlist protection for development environment
  if (isDevelopment) {
    return NextResponse.next()
  }

  // If user has an active session, allow them to access any route
  if (hasActiveSession) {
    return NextResponse.next()
  }

  // Handle waitlist protection for login and signup in production
  if (url.pathname === '/login' || url.pathname === '/signup') {
    // If this is the login page and user has logged in before, allow access
    if (hasPreviouslyLoggedIn && request.nextUrl.pathname === '/login') {
      return NextResponse.next()
    }

    // Check for a waitlist token in the URL
    const waitlistToken = url.searchParams.get('token')

    // If there's a redirect to the invite page, bypass waitlist check
    const redirectParam = request.nextUrl.searchParams.get('redirect')
    if (redirectParam && redirectParam.startsWith('/invite/')) {
      return NextResponse.next()
    }

    // Validate the token if present
    if (waitlistToken) {
      try {
        const decodedToken = await verifyToken(waitlistToken)

        // If token is valid and is a waitlist approval token
        if (decodedToken && decodedToken.type === 'waitlist-approval') {
          // Check token expiration
          const now = Math.floor(Date.now() / 1000)
          if (decodedToken.exp > now) {
            // Token is valid and not expired, allow access
            return NextResponse.next()
          }
        }

        // Token is invalid, expired, or wrong type - redirect to home
        if (url.pathname === '/signup') {
          return NextResponse.redirect(new URL('/', request.url))
        }
      } catch (error) {
        logger.error('Token validation error:', error)
        // In case of error, redirect signup attempts to home
        if (url.pathname === '/signup') {
          return NextResponse.redirect(new URL('/', request.url))
        }
      }
    } else {
      // If no token for signup, redirect to home
      if (url.pathname === '/signup') {
        return NextResponse.redirect(new URL('/', request.url))
      }
    }
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

    // Return 403 with security headers
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
