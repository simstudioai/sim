import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { authenticateCopilotRequestSessionOnly } from '@/lib/copilot/auth'
import { simAgentClient } from '@/lib/sim-agent'

const logger = createLogger('CopilotToolsCompleteAPI')

const Schema = z.object({
  toolId: z.string().min(1),
  methodId: z.string().min(1),
  success: z.boolean(),
  data: z.any().optional(),
  error: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID()
  const start = Date.now()

  try {
    const sessionAuth = await authenticateCopilotRequestSessionOnly()
    if (!sessionAuth.isAuthenticated) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { toolId, methodId, success, data, error } = Schema.parse(body)

    logger.info(`[${requestId}] Forwarding tool completion to sim-agent`, {
      toolId,
      methodId,
      success,
      hasData: data !== undefined,
      hasError: !!error,
    })

    const resp = await simAgentClient.makeRequest('/api/complete-tool', {
      method: 'POST',
      body: { toolId, methodId, success, ...(success ? { data } : { error: error || 'Unknown' }) },
    })

    const duration = Date.now() - start
    logger.info(`[${requestId}] Sim-agent completion response`, {
      status: resp.status,
      success: resp.success,
      duration,
    })

    return NextResponse.json(resp)
  } catch (e) {
    logger.error('Failed to forward tool completion', {
      error: e instanceof Error ? e.message : 'Unknown error',
    })
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: e.errors.map((er) => er.message).join(', ') },
        { status: 400 }
      )
    }
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
} 