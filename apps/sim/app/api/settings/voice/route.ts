import { NextResponse } from 'next/server'
import { hasSTTService } from '@/lib/speech/config'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

/**
 * Returns whether server-side STT is configured.
 * Unauthenticated — the response is a single boolean,
 * not sensitive data, and deployed chat visitors need it.
 */
export const GET = withRouteHandler(async () => {
  return NextResponse.json({ sttAvailable: hasSTTService() })
})
