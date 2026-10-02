import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  FREEBUFF_AGENTIC_COOKIE,
  FREEBUFF_ATTRIBUTION_TTL_SECONDS,
  readFreebuffAttribution,
  readFreebuffHandoff,
  sealFreebuffAttribution,
} from '@/lib/analytics/freebuff-agentic'
import {
  type FreebuffLandingQuery,
  freebuffLandingContract,
} from '@/lib/api/contracts/freebuff-attribution'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { enforceIpRateLimit } from '@/lib/core/rate-limiter'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { bindAccountAttribution } from '@/lib/users/application/attribution'

const logger = createLogger('FreebuffLanding')

/** Capture before rendering any page or loading analytics; the redirect URL never carries bfcid. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const destination = new URL('/signup', getBaseUrl())
  let sealed: string | undefined
  let clearCookie = false
  const limited = await enforceIpRateLimit('freebuff-landing', request)
  if (limited) {
    limited.headers.set('Cache-Control', 'no-store')
    limited.headers.set('Referrer-Policy', 'no-referrer')
    return limited
  }
  const parsed = await parseRequest(freebuffLandingContract, request, {})
  if (parsed.success) {
    const query: FreebuffLandingQuery = parsed.data.query
    try {
      if (query.request && query.challenge && query.pairing) {
        destination.pathname = '/cli/auth'
        destination.search = new URLSearchParams({
          request: query.request,
          challenge: query.challenge,
          pairing: query.pairing,
          scope: 'platform',
          ...(query.workspace ? { workspace: query.workspace } : {}),
        }).toString()
        sealed = await readFreebuffHandoff(query.request, query.challenge)
      } else if (query.bfcid) {
        sealed = await sealFreebuffAttribution(query.bfcid)
      }
      if (await readFreebuffAttribution(sealed)) {
        const session = await getSession()
        if (session?.user.id && sealed) {
          if (!('impersonatedBy' in session.session && session.session.impersonatedBy)) {
            await bindAccountAttribution.execute({
              principal: {
                kind: 'session',
                userId: session.user.id,
                sessionId: session.session.id,
              },
              input: { sealed },
            })
          }
          sealed = undefined
          clearCookie = true
        }
      } else {
        sealed = undefined
      }
    } catch {
      logger.warn('Attribution capture unavailable')
      sealed = undefined
    }
  }
  const response = NextResponse.redirect(destination, 303)
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  if (sealed || clearCookie)
    response.cookies.set(FREEBUFF_AGENTIC_COOKIE, sealed ?? '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: clearCookie ? 0 : FREEBUFF_ATTRIBUTION_TTL_SECONDS,
    })
  return response
})
