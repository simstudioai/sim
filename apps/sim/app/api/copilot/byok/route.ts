import { db } from '@sim/db'
import { settings, user } from '@sim/db/schema'
import { getErrorMessage } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  deleteCopilotByokKeyContract,
  listCopilotByokKeysContract,
  upsertCopilotByokKeyContract,
} from '@/lib/api/contracts/copilot'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { getMothershipSourceEnvHeaders } from '@/lib/copilot/server/agent-url'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

/**
 * Enterprise BYOK key management for the current workspace's mothership.
 *
 * Unlike the cross-environment admin inspector (`/api/admin/mothership`), this
 * talks to the SAME copilot the workspace's mothership actually runs on —
 * `SIM_AGENT_API_URL` (local in dev, prod copilot in prod) — and authenticates
 * with the hosted internal key (`COPILOT_API_KEY`), the exact credential
 * mothership chat uses. Copilot requires that key (`SIM_AGENT_API_KEY`) and
 * rejects self-hosted callers, so BYOK can only ever be written through our
 * hosted Sim. The route is superuser-gated; the workspace id rides in the
 * request and is resolved by the caller from the route.
 */
async function getAuthorizedSuperUserId(): Promise<string | null> {
  const session = await getSession()
  if (!session?.user?.id) return null

  const [currentUser] = await db
    .select({ role: user.role, superUserModeEnabled: settings.superUserModeEnabled })
    .from(user)
    .leftJoin(settings, eq(settings.userId, user.id))
    .where(eq(user.id, session.user.id))
    .limit(1)

  const authorized = currentUser?.role === 'admin' && (currentUser.superUserModeEnabled ?? false)
  return authorized ? session.user.id : null
}

async function forwardToCopilot(
  method: 'GET' | 'POST' | 'DELETE',
  query: URLSearchParams,
  body?: string
) {
  const headers: Record<string, string> = { ...getMothershipSourceEnvHeaders() }
  if (env.COPILOT_API_KEY) headers['x-api-key'] = env.COPILOT_API_KEY
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const qs = query.toString()
  const targetUrl = `${SIM_AGENT_API_URL}/api/admin/byok${qs ? `?${qs}` : ''}`

  try {
    const upstream = await fetch(targetUrl, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
    })
    const text = await upstream.text()
    // boundary-raw-fetch: copilot returns JSON; tolerate an empty body.
    const data = text ? JSON.parse(text) : {}
    return NextResponse.json(data, { status: upstream.status })
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to reach copilot: ${getErrorMessage(error, 'Unknown error')}` },
      { status: 502 }
    )
  }
}

export const GET = withRouteHandler(async (req: NextRequest) => {
  const userId = await getAuthorizedSuperUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(listCopilotByokKeysContract, req, {})
  if (!parsed.success) return parsed.response

  return forwardToCopilot(
    'GET',
    new URLSearchParams({ workspaceId: parsed.data.query.workspaceId })
  )
})

export const POST = withRouteHandler(async (req: NextRequest) => {
  const userId = await getAuthorizedSuperUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(upsertCopilotByokKeyContract, req, {})
  if (!parsed.success) return parsed.response

  // Bind the audit field to the authenticated superuser, ignoring any
  // client-supplied createdBy so provisioning is always attributable.
  const body = JSON.stringify({ ...parsed.data.body, createdBy: userId })
  return forwardToCopilot('POST', new URLSearchParams(), body)
})

export const DELETE = withRouteHandler(async (req: NextRequest) => {
  const userId = await getAuthorizedSuperUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(deleteCopilotByokKeyContract, req, {})
  if (!parsed.success) return parsed.response

  return forwardToCopilot(
    'DELETE',
    new URLSearchParams({
      workspaceId: parsed.data.query.workspaceId,
      provider: parsed.data.query.provider,
    })
  )
})
