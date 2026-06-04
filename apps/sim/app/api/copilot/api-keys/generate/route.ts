import { type NextRequest, NextResponse } from 'next/server'
import { generateCopilotApiKeyContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { fetchGo } from '@/lib/copilot/request/go/fetch'
import { getMothershipBaseURL } from '@/lib/copilot/server/agent-url'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const POST = withRouteHandler(async (req: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const mothershipBaseURL = await getMothershipBaseURL({ userId })

    const parsed = await parseRequest(generateCopilotApiKeyContract, req, {})
    if (!parsed.success) return parsed.response

    const { name } = parsed.data.body

    const res = await fetchGo(`${mothershipBaseURL}/api/validate-key/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
      },
      body: JSON.stringify({ userId, name }),
      spanName: 'sim → go /api/validate-key/generate',
      operation: 'generate_api_key',
      attributes: { [TraceAttr.UserId]: userId },
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to generate copilot API key' },
        { status: res.status || 500 }
      )
    }

    const data = (await res.json().catch(() => null)) as { apiKey?: string; id?: string } | null

    if (!data?.apiKey) {
      return NextResponse.json({ error: 'Invalid response from Sim Agent' }, { status: 500 })
    }

    return NextResponse.json(
      { success: true, key: { id: data?.id || 'new', apiKey: data.apiKey } },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json({ error: 'Failed to generate copilot API key' }, { status: 500 })
  }
})
