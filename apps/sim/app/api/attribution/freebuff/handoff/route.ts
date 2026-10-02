import { type NextRequest, NextResponse } from 'next/server'
import { sealFreebuffAttribution, storeFreebuffHandoff } from '@/lib/analytics/freebuff-agentic'
import {
  type FreebuffHandoffBody,
  freebuffHandoffContract,
} from '@/lib/api/contracts/freebuff-attribution'
import { parseRequest } from '@/lib/api/server'
import { enforceIpRateLimit } from '@/lib/core/rate-limiter'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

/** Public device-flow initialization; holds no account authority and never issues credentials. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const limited = await enforceIpRateLimit('freebuff-handoff', request)
  if (limited) return limited
  const parsed = await parseRequest(freebuffHandoffContract, request, {})
  if (!parsed.success) return parsed.response
  try {
    const body: FreebuffHandoffBody = parsed.data.body
    const sealed = await sealFreebuffAttribution(body.conversionToken)
    await storeFreebuffHandoff(body.request, body.challenge, sealed)
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Attribution handoff unavailable' }, { status: 503 })
  }
})
