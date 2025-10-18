import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { getCopilotModel } from '@/lib/copilot/config'
import type { CopilotProviderConfig } from '@/lib/copilot/types'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { SIM_AGENT_API_URL_DEFAULT } from '@/lib/sim-agent/constants'

const logger = createLogger('ContextUsageAPI')

const SIM_AGENT_API_URL = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT

const ContextUsageRequestSchema = z.object({
  chatId: z.string(),
  model: z.string(),
  workflowId: z.string(),
  provider: z.any().optional(),
})

/**
 * POST /api/copilot/context-usage
 * Fetch context usage from sim-agent API
 */
export async function POST(req: NextRequest) {
  try {
    logger.info('[Context Usage API] Request received')

    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn('[Context Usage API] No session/user ID')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    logger.info('[Context Usage API] Request body', body)

    const parsed = ContextUsageRequestSchema.safeParse(body)

    if (!parsed.success) {
      logger.warn('[Context Usage API] Invalid request body', parsed.error.errors)
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.errors },
        { status: 400 }
      )
    }

    const { chatId, model, workflowId, provider } = parsed.data
    const userId = session.user.id // Get userId from session, not from request

    logger.info('[Context Usage API] Request validated', { chatId, model, userId, workflowId })

    // Build provider config similar to chat route
    let providerConfig: CopilotProviderConfig | undefined = provider
    if (!providerConfig) {
      const defaults = getCopilotModel('chat')
      const modelToUse = env.COPILOT_MODEL || defaults.model
      const providerEnv = env.COPILOT_PROVIDER as any

      if (providerEnv) {
        if (providerEnv === 'azure-openai') {
          providerConfig = {
            provider: 'azure-openai',
            model: modelToUse,
            apiKey: env.AZURE_OPENAI_API_KEY,
            apiVersion: env.AZURE_OPENAI_API_VERSION,
            endpoint: env.AZURE_OPENAI_ENDPOINT,
          }
        } else {
          providerConfig = {
            provider: providerEnv,
            model: modelToUse,
            apiKey: env.COPILOT_API_KEY,
          }
        }
      }
    }

    // Call sim-agent API
    const requestPayload = {
      chatId,
      model,
      userId,
      workflowId,
      ...(providerConfig ? { provider: providerConfig } : {}),
    }

    logger.info('[Context Usage API] Calling sim-agent', {
      url: `${SIM_AGENT_API_URL}/api/get-context-usage`,
      payload: requestPayload,
    })

    const simAgentResponse = await fetch(`${SIM_AGENT_API_URL}/api/get-context-usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
      },
      body: JSON.stringify(requestPayload),
    })

    logger.info('[Context Usage API] Sim-agent response', {
      status: simAgentResponse.status,
      ok: simAgentResponse.ok,
    })

    if (!simAgentResponse.ok) {
      const errorText = await simAgentResponse.text().catch(() => '')
      logger.warn('[Context Usage API] Sim agent request failed', {
        status: simAgentResponse.status,
        error: errorText,
      })
      return NextResponse.json(
        { error: 'Failed to fetch context usage from sim-agent' },
        { status: simAgentResponse.status }
      )
    }

    const data = await simAgentResponse.json()
    logger.info('[Context Usage API] Sim-agent data received', data)
    return NextResponse.json(data)
  } catch (error) {
    logger.error('Error fetching context usage:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
