import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { fetchGo } from '@/lib/copilot/request/go/fetch'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

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
    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
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
