import { db } from '@sim/db'
import { apiKey as apiKeyTable } from '@sim/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { deleteCopilotApiKeyQuerySchema } from '@/lib/api/contracts'
import { getSession } from '@/lib/auth'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { fetchGo } from '@/lib/copilot/request/go/fetch'
import { env } from '@/lib/core/config/env'
import { isHosted } from '@/lib/core/config/feature-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Self-hosted: list user's personal keys directly from the api_key
    // table. These are the same keys the generate endpoint creates and
    // are valid for X-API-Key auth on /api/mcp/copilot (via the
    // local-first lookup in route.ts).
    if (!isHosted) {
      const rows = await db
        .select({
          id: apiKeyTable.id,
          name: apiKeyTable.name,
          keyHash: apiKeyTable.keyHash,
          createdAt: apiKeyTable.createdAt,
          lastUsed: apiKeyTable.lastUsed,
        })
        .from(apiKeyTable)
        .where(and(eq(apiKeyTable.userId, userId), eq(apiKeyTable.type, 'personal')))
        .orderBy(desc(apiKeyTable.createdAt))
      const keys = rows.map((k) => ({
        id: k.id,
        // Last 6 of keyHash for display (we don't decrypt the stored key here)
        displayKey: `•••••${(k.keyHash || '').slice(-6)}`,
        name: k.name,
        createdAt: k.createdAt ? k.createdAt.toISOString() : null,
        lastUsed: k.lastUsed ? k.lastUsed.toISOString() : null,
      }))
      return NextResponse.json({ keys }, { status: 200 })
    }

    const res = await fetchGo(`${SIM_AGENT_API_URL}/api/validate-key/get-api-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
      },
      body: JSON.stringify({ userId }),
      spanName: 'sim → go /api/validate-key/get-api-keys',
      operation: 'get_api_keys',
      attributes: { [TraceAttr.UserId]: userId },
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to get keys' }, { status: res.status || 500 })
    }

    const apiKeys = (await res.json().catch(() => null)) as
      | { id: string; apiKey: string; name?: string; createdAt?: string; lastUsed?: string }[]
      | null

    if (!Array.isArray(apiKeys)) {
      return NextResponse.json({ error: 'Invalid response from Sim Agent' }, { status: 500 })
    }

    const keys = apiKeys.map((k) => {
      const value = typeof k.apiKey === 'string' ? k.apiKey : ''
      const last6 = value.slice(-6)
      const displayKey = `•••••${last6}`
      return {
        id: k.id,
        displayKey,
        name: k.name || null,
        createdAt: k.createdAt || null,
        lastUsed: k.lastUsed || null,
      }
    })

    return NextResponse.json({ keys }, { status: 200 })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to get keys' }, { status: 500 })
  }
})

export const DELETE = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const queryResult = deleteCopilotApiKeyQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams)
    )
    if (!queryResult.success) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }
    const { id } = queryResult.data

    // Self-hosted: delete the row directly. Scoped to the requesting user
    // so callers can only delete their own keys.
    if (!isHosted) {
      const deleted = await db
        .delete(apiKeyTable)
        .where(and(eq(apiKeyTable.id, id), eq(apiKeyTable.userId, userId)))
        .returning({ id: apiKeyTable.id })
      if (deleted.length === 0) {
        return NextResponse.json({ error: 'Key not found' }, { status: 404 })
      }
      return NextResponse.json({ success: true }, { status: 200 })
    }

    const res = await fetchGo(`${SIM_AGENT_API_URL}/api/validate-key/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
      },
      body: JSON.stringify({ userId, apiKeyId: id }),
      spanName: 'sim → go /api/validate-key/delete',
      operation: 'delete_api_key',
      attributes: { [TraceAttr.UserId]: userId, [TraceAttr.ApiKeyId]: id },
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to delete key' }, { status: res.status || 500 })
    }

    const data = (await res.json().catch(() => null)) as { success?: boolean } | null
    if (!data?.success) {
      return NextResponse.json({ error: 'Invalid response from Sim Agent' }, { status: 500 })
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete key' }, { status: 500 })
  }
})
