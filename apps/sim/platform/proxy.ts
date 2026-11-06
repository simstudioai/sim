import { NextResponse } from 'next/server'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { liveSecurityHeaders } from '@/platform/lib/data/security-headers'

/**
 * The main app's headers never reach a page it proxies here: Next drops what its proxy set when a
 * rewrite leaves for another origin. So the zone sets them itself, on live data only.
 */
export function proxy() {
  const response = NextResponse.next()
  if (resolvePlatformMode() === 'live') {
    for (const [name, value] of Object.entries(liveSecurityHeaders())) {
      response.headers.set(name, value)
    }
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon).*)'],
}
