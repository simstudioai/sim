import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { SIM_AGENT_API_URL_DEFAULT } from '@/lib/sim-agent'

const logger = createLogger('CopilotApiKeys')

const SIM_AGENT_API_URL = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const res = await fetch(`${SIM_AGENT_API_URL}/api/validate-key/get-api-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '')
      logger.error('Sim Agent get-api-keys error', { status: res.status, error: errorBody })
      return NextResponse.json({ error: 'Failed to get keys' }, { status: res.status || 500 })
    }

    const apiKeys = (await res.json().catch(() => null)) as { id: string; apiKey: string }[] | null

    if (!Array.isArray(apiKeys)) {
      logger.error('Sim Agent get-api-keys returned invalid payload')
      return NextResponse.json({ error: 'Invalid response from Sim Agent' }, { status: 500 })
    }

    const keys = apiKeys

    return NextResponse.json({ keys }, { status: 200 })
  } catch (error) {
    logger.error('Failed to get copilot API keys', { error })
    return NextResponse.json({ error: 'Failed to get keys' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
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

    const res = await fetch(`${SIM_AGENT_API_URL}/api/validate-key/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, apiKeyId: id }),
    })

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '')
      logger.error('Sim Agent delete key error', { status: res.status, error: errorBody })
      return NextResponse.json({ error: 'Failed to delete key' }, { status: res.status || 500 })
    }

    const data = (await res.json().catch(() => null)) as { success?: boolean } | null
    if (!data?.success) {
      logger.error('Sim Agent delete key returned invalid payload')
      return NextResponse.json({ error: 'Invalid response from Sim Agent' }, { status: 500 })
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error('Failed to delete copilot API key', { error })
    return NextResponse.json({ error: 'Failed to delete key' }, { status: 500 })
  }
}
