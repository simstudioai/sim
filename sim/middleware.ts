import { NextRequest, NextResponse } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'

// Environment flag to check if we're in development mode
const isDevelopment = process.env.NODE_ENV === 'development'

// Admin emails - ideally from environment variables
const ADMIN_EMAILS =
  process.env.ADMIN_EMAILS?.split(',').map((email) => email.trim().toLowerCase()) || []

export async function middleware(request: NextRequest) {
  // Check if the path is exactly /w
  if (request.nextUrl.pathname === '/w') {
    return NextResponse.redirect(new URL('/w/1', request.url))
  }

  // Handle admin routes protection
  if (request.nextUrl.pathname.startsWith('/admin')) {
    const sessionCookie = getSessionCookie(request)

    // In development, bypass admin check if no ADMIN_EMAILS is set
    if (isDevelopment && !process.env.ADMIN_EMAILS) {
      return NextResponse.next()
    }

    // No session, redirect to login
    if (!sessionCookie) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    try {
      // Get session from cookie
      const session = await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/session?token=${sessionCookie}`
      )
      const sessionData = await session.json()

      // Check if user email is in admin list
      if (
        !sessionData.user?.email ||
        !ADMIN_EMAILS.includes(sessionData.user.email.toLowerCase())
      ) {
        // Not an admin, redirect to unauthorized
        return NextResponse.redirect(new URL('/', request.url))
      }
    } catch (error) {
      console.error('Error validating admin access:', error)
      return NextResponse.redirect(new URL('/', request.url))
    }

    // Admin access granted
    return NextResponse.next()
  }

  // Handle protected routes that require authentication
  if (request.nextUrl.pathname.startsWith('/w/') || request.nextUrl.pathname === '/w') {
    const sessionCookie = getSessionCookie(request)
    if (!sessionCookie) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return NextResponse.next()
  }

  // Skip waitlist protection for development environment
  if (isDevelopment) {
    return NextResponse.next()
  }

  // Handle waitlist protection for login and signup in production
  if (request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/signup') {
    // Check for a waitlist token in the URL - this should be handled by the page itself
    const waitlistToken = request.nextUrl.searchParams.get('token')

    // Always allow access if a token is provided - validation happens in the page
    if (waitlistToken) {
      return NextResponse.next()
    }

    // If this is the signup page without a token, redirect to the waitlist page
    if (request.nextUrl.pathname === '/signup') {
      return NextResponse.redirect(new URL('/', request.url))
    }
  }

  return NextResponse.next()
}

// Update matcher to include admin routes
export const config = {
  matcher: [
    '/w', // Match exactly /w
    '/w/:path*', // Match protected routes
    '/admin/:path*', // Match admin routes
    '/login',
    '/signup',
  ],
}
