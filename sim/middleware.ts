import { NextRequest, NextResponse } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'
import { verifyToken } from './lib/waitlist/token'

// Environment flag to check if we're in development mode
const isDevelopment = process.env.NODE_ENV === 'development'
const BASE_DOMAIN = isDevelopment ? 'localhost:3000' : 'simstudio.ai'

export async function middleware(request: NextRequest) {
  const url = request.nextUrl
  const hostname = request.headers.get('host') || ''
    
  // Extract subdomain
  const isCustomDomain = hostname !== BASE_DOMAIN && 
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
    const sessionCookie = getSessionCookie(request)
    if (!sessionCookie) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    // Add session expiration validation if better-auth provides this functionality
    // This would depend on the implementation of better-auth

    return NextResponse.next()
  }

  // Skip waitlist protection for development environment
  if (isDevelopment) {
    return NextResponse.next()
  }

  // Handle waitlist protection for login and signup in production
  if (url.pathname === '/login' || url.pathname === '/signup') {
    // Check for a waitlist token in the URL
    const waitlistToken = url.searchParams.get('token')

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
        console.error('Token validation error:', error)
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

  return NextResponse.next()
}

// Update matcher to include subdomains and preserve existing routes
export const config = {
  matcher: [
    '/w', // Match exactly /w
    '/w/:path*', // Match protected routes
    '/login',
    '/signup',
    // Path matcher to catch all paths except certain ones
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
