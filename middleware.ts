import { NextRequest, NextResponse } from 'next/server'
import { getSessionCookie } from 'better-auth'

export async function middleware(request: NextRequest) {
  // Check if the path is exactly /w
  if (request.nextUrl.pathname === '/w') {
    return NextResponse.redirect(new URL('/w/1', request.url))
  }

  // Existing auth check for protected routes
  const sessionCookie = getSessionCookie(request)
  if (!sessionCookie) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  return NextResponse.next()
}

// TODO: Add protected routes
export const config = {
  matcher: [
    '/w', // Match exactly /w
    '/w/:path*', // Keep existing matcher for protected routes
  ],
}
