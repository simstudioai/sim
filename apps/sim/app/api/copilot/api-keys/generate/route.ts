import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { SIM_AGENT_API_URL_DEFAULT } from '@/lib/sim-agent'

const logger = createLogger('CopilotApiKeysGenerate')

const SIM_AGENT_API_URL = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const res = await fetch(`${SIM_AGENT_API_URL}/api/validate-key/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '')
      logger.error('Sim Agent generate key error', { status: res.status, error: errorBody })
      return NextResponse.json(
        { error: 'Failed to generate copilot API key' },
        { status: res.status || 500 }
      )
    }

    const data = (await res.json().catch(() => null)) as { apiKey?: string } | null

    if (!data?.apiKey) {
      logger.error('Sim Agent generate key returned invalid payload')
      return NextResponse.json({ error: 'Invalid response from Sim Agent' }, { status: 500 })
    }

    return NextResponse.json(
      { success: true, key: { id: 'new', apiKey: data.apiKey } },
      { status: 201 }
    )
  } catch (error) {
    logger.error('Failed to proxy generate copilot API key', { error })
    return NextResponse.json({ error: 'Failed to generate copilot API key' }, { status: 500 })
  }
}
