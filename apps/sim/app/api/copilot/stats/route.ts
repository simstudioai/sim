import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/auth'
import { env } from '@/lib/env'
import { SIM_AGENT_API_URL_DEFAULT } from '@/lib/sim-agent'

const SIM_AGENT_API_URL = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT

const BodySchema = z
  .object({
    // Do NOT send id; messageId is the unique correlator
    userId: z.string().optional(),
    chatId: z.string().uuid().optional(),
    messageId: z.string().optional(),
    depth: z.number().int().nullable().optional(),
    maxEnabled: z.boolean().nullable().optional(),
    createdAt: z.union([z.string().datetime(), z.date()]).optional(),
    diffCreated: z.boolean().nullable().optional(),
    diffAccepted: z.boolean().nullable().optional(),
    duration: z.number().int().nullable().optional(),
    inputTokens: z.number().int().nullable().optional(),
    outputTokens: z.number().int().nullable().optional(),
    aborted: z.boolean().nullable().optional(),
  })
  .passthrough()

export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const json = await req.json().catch(() => ({}))
    const parsed = BodySchema.safeParse(json)
    if (!parsed.success) {
      return createBadRequestResponse('Invalid request body for copilot stats')
    }
    const body = parsed.data as any

    // Build outgoing payload for Sim Agent; do not include id
    const payload: Record<string, any> = {
      ...body,
      userId: body.userId || userId,
      createdAt: body.createdAt || new Date().toISOString(),
    }
    payload.id = undefined

    const agentRes = await fetch(`${SIM_AGENT_API_URL}/api/stats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
      },
      body: JSON.stringify(payload),
    })

    // Prefer not to block clients; still relay status
    let agentJson: any = null
    try {
      agentJson = await agentRes.json()
    } catch {}

    if (!agentRes.ok) {
      const message = (agentJson && (agentJson.error || agentJson.message)) || 'Upstream error'
      return NextResponse.json({ success: false, error: message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return createInternalServerErrorResponse('Failed to forward copilot stats')
  }
}
