import { NextRequest, NextResponse } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'
import { verifyToken } from './lib/waitlist/token'

// Environment flag to check if we're in development mode
const isDevelopment = process.env.NODE_ENV === 'development'

export async function middleware(request: NextRequest) {
  // Check for active session
  const sessionCookie = getSessionCookie(request)
  const hasActiveSession = !!sessionCookie

  // Check if user has previously logged in by checking localStorage value in cookies
  const hasPreviouslyLoggedIn = request.cookies.get('has_logged_in_before')?.value === 'true'

  // Check if the path is exactly /w
  if (request.nextUrl.pathname === '/w') {
    return NextResponse.redirect(new URL('/w/1', request.url))
  }

  // Handle protected routes that require authentication
  if (request.nextUrl.pathname.startsWith('/w/') || request.nextUrl.pathname === '/w') {
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
  if (request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/signup') {
    // If this is the login page and user has logged in before, allow access
    if (hasPreviouslyLoggedIn && request.nextUrl.pathname === '/login') {
      return NextResponse.next()
    }

    // Check for a waitlist token in the URL
    const waitlistToken = request.nextUrl.searchParams.get('token')
    
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
        if (request.nextUrl.pathname === '/signup') {
          return NextResponse.redirect(new URL('/', request.url))
        }
      } catch (error) {
        console.error('Token validation error:', error)
        // In case of error, redirect signup attempts to home
        if (request.nextUrl.pathname === '/signup') {
          return NextResponse.redirect(new URL('/', request.url))
        }
      }
    } else {
      // If no token for signup, redirect to home
      if (request.nextUrl.pathname === '/signup') {
        return NextResponse.redirect(new URL('/', request.url))
      }
    }
  }

  return NextResponse.next()
}

// Update matcher to include admin routes
export const config = {
  matcher: [
    '/w', // Match exactly /w
    '/w/:path*', // Match protected routes
    '/login',
    '/signup',
  ],
}
