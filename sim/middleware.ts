import { NextRequest, NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
   // Check if the path is exactly /w
   if (request.nextUrl.pathname === '/w') {
    return NextResponse.redirect(new URL('/w/1', request.url))
  }

  // Skip auth check if DISABLE_AUTH is set (for standalone mode)
  if (process.env.DISABLE_AUTH === 'true' || process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true') {
    return NextResponse.next()
  }

  const cookieHeader = request.headers.get("cookie");
  const cookies = cookieHeader?.split("; ").reduce((acc, cookie) => {
    const [key, value] = cookie.split("=");
    acc.set(key, value);
    return acc;
  }, new Map());

  const sessionCookie =
    cookies?.get("better-auth.session_token") ||
    cookies?.get("__Secure-better-auth.session_token");

  // Existing auth check for protected routes
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