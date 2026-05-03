import { db } from '@sim/db'
import { apiKey as apiKeyTable } from '@sim/db/schema'
import { generateShortId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { generateCopilotApiKeyContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { createApiKey } from '@/lib/api-key/auth'
import { hashApiKey } from '@/lib/api-key/crypto'
import { getSession } from '@/lib/auth'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { fetchGo } from '@/lib/copilot/request/go/fetch'
import { env } from '@/lib/core/config/env'
import { isHosted } from '@/lib/core/config/feature-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const POST = withRouteHandler(async (req: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const parsed = await parseRequest(generateCopilotApiKeyContract, req, {})
    if (!parsed.success) return parsed.response

    const { name } = parsed.data.body

    // Self-hosted: create the key locally as a personal API key. The
    // Mothership service does not trust self-hosted callers, so the
    // remote generation flow always fails. Local keys work everywhere
    // (X-API-Key on /api/mcp/copilot, /api/v1/workflows/{id}/execute, etc.).
    if (!isHosted) {
      const { key: plainKey, encryptedKey } = await createApiKey(true)
      if (!encryptedKey) {
        return NextResponse.json({ error: 'Failed to encrypt API key' }, { status: 500 })
      }
      const id = generateShortId()
      await db.insert(apiKeyTable).values({
        id,
        userId,
        workspaceId: null,
        name,
        key: encryptedKey,
        keyHash: hashApiKey(plainKey),
        type: 'personal',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      return NextResponse.json(
        { success: true, key: { id, apiKey: plainKey } },
        { status: 201 }
      )
    }

    const res = await fetchGo(`${SIM_AGENT_API_URL}/api/validate-key/generate`, {
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
