import { NextRequest, NextResponse } from 'next/server'
import { getSessionCookie } from 'better-auth'

export async function middleware(request: NextRequest) {
  const sessionCookie = getSessionCookie(request)
  if (!sessionCookie) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  return NextResponse.next()
}

// TODO: Add protected routes
export const config = {
  matcher: ['/dashboard/:path*'],
}
