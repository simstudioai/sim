import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { a2aServeAgentParamsSchema } from '@/lib/api/contracts/a2a-agents'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getServedAgentCard } from '@/app/api/a2a/serve/[agentId]/utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface RouteParams {
  agentId: string
}

/**
 * GET - A2A v0.3 well-known discovery endpoint.
 *
 * Serves the Agent Card at the RFC 8615 context path
 * (`/api/a2a/serve/{agentId}/.well-known/agent-card.json`) so standard A2A
 * clients that append the well-known path to an agent's base URL can discover
 * Sim-hosted agents.
 */
export const GET = withRouteHandler(
  async (_request: NextRequest, { params }: { params: Promise<RouteParams> }) => {
    const { agentId } = a2aServeAgentParamsSchema.parse(await params)

    const result = await getServedAgentCard(agentId)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json(result.card, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
        'X-Cache': result.cacheHit ? 'HIT' : 'MISS',
      },
    })
  }
)
