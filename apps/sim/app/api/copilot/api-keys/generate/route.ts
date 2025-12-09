import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { SIM_AGENT_API_URL_DEFAULT } from '@/lib/copilot/constants'
import { env } from '@/lib/core/config/env'

const GenerateApiKeySchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name is too long'),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Move environment variable access inside the function
    const SIM_AGENT_API_URL = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT

    const body = await req.json().catch(() => ({}))
    const validationResult = GenerateApiKeySchema.safeParse(body)

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: validationResult.error.errors,
        },
        { status: 400 }
      )
    }

    const { name } = validationResult.data

    const res = await fetch(`${SIM_AGENT_API_URL}/api/validate-key/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
      },
      body: JSON.stringify({ userId, name }),
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
}
