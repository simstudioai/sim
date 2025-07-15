import { getSessionCookie } from 'better-auth/cookies'
import { type NextRequest, NextResponse } from 'next/server'
import { isDev } from './lib/environment'
import { createLogger } from './lib/logs/console-logger'
import { getBaseDomain } from './lib/urls/utils'

const logger = createLogger('Middleware')

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

  const url = request.nextUrl
  const hostname = request.headers.get('host') || ''

  // Extract subdomain - handle nested subdomains for any domain
  const isCustomDomain = (() => {
    // Standard check for non-base domains
    if (hostname === BASE_DOMAIN || hostname.startsWith('www.')) {
      return false
    }

    // Extract root domain from BASE_DOMAIN (e.g., "simstudio.ai" from "staging.simstudio.ai")
    const baseParts = BASE_DOMAIN.split('.')
    const rootDomain = isDev
      ? 'localhost'
      : baseParts.length >= 2
        ? baseParts
            .slice(-2)
            .join('.') // Last 2 parts: ["simstudio", "ai"] -> "simstudio.ai"
        : BASE_DOMAIN

    // Check if hostname is under the same root domain
    if (!hostname.includes(rootDomain)) {
      return false
    }

    // For nested subdomain environments: handle cases like myapp.staging.example.com
    const hostParts = hostname.split('.')
    const basePartCount = BASE_DOMAIN.split('.').length

    // If hostname has more parts than base domain, it's a nested subdomain
    if (hostParts.length > basePartCount) {
      return true
    }

    // For single-level subdomains: regular subdomain logic
    return hostname !== BASE_DOMAIN
  })()

  const subdomain = isCustomDomain ? hostname.split('.')[0] : null

  // Handle chat subdomains
  if (subdomain && isCustomDomain) {
    if (url.pathname.startsWith('/api/chat/') || url.pathname.startsWith('/api/proxy/')) {
      return NextResponse.next()
    }

    // Rewrite to the chat page but preserve the URL in browser
    return NextResponse.rewrite(new URL(`/chat/${subdomain}${url.pathname}`, request.url))
  }

  // Legacy redirect: /w -> /workspace (will be handled by workspace layout)
  if (url.pathname === '/w' || url.pathname.startsWith('/w/')) {
    // Extract workflow ID if present
    const pathParts = url.pathname.split('/')
    if (pathParts.length >= 3 && pathParts[1] === 'w') {
      const workflowId = pathParts[2]
      // Redirect old workflow URLs to new format
      // We'll need to resolve the workspace ID for this workflow
      return NextResponse.redirect(
        new URL(`/workspace?redirect_workflow=${workflowId}`, request.url)
      )
    }
    // Simple /w redirect to workspace root
    return NextResponse.redirect(new URL('/workspace', request.url))
  }

  // Handle protected routes that require authentication
  if (url.pathname.startsWith('/workspace')) {
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

  const userAgent = request.headers.get('user-agent') || ''

  // Check if this is a webhook endpoint that should be exempt from User-Agent validation
  const isWebhookEndpoint = url.pathname.startsWith('/api/webhooks/trigger/')

  const isSuspicious = SUSPICIOUS_UA_PATTERNS.some((pattern) => pattern.test(userAgent))

  // Block suspicious requests, but exempt webhook endpoints from User-Agent validation only
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

  const response = NextResponse.next()
  response.headers.set('Vary', 'User-Agent')
  return response
}

// Update matcher to include invitation routes
export const config = {
  matcher: [
    '/w', // Legacy /w redirect
    '/w/:path*', // Legacy /w/* redirects
    '/workspace/:path*', // New workspace routes
    '/login',
    '/signup',
    '/invite/:path*', // Match invitation routes
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
