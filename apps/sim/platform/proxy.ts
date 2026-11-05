import { type NextRequest, NextResponse } from 'next/server'
import { isLiveZone, liveSecurityHeaders } from '@/platform/lib/data/security-headers'

/**
 * The main app's headers never reach a page it proxies here: Next drops what its proxy set when a
 * rewrite leaves for another origin. So the zone sets them itself, on live data only.
 */
export function proxy(_request: NextRequest) {
  const response = NextResponse.next()
  if (isLiveZone()) {
    for (const [name, value] of Object.entries(liveSecurityHeaders())) {
      response.headers.set(name, value)
    }
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon).*)'],
}
