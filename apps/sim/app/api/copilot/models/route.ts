import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { authenticateCopilotRequestSessionOnly } from '@/lib/copilot/request-helpers'
import { env } from '@/lib/core/config/env'
import type { AvailableModel } from '@/lib/copilot/types'

const logger = createLogger('CopilotModelsAPI')

export async function GET(_req: NextRequest) {
  const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
  if (!isAuthenticated || !userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (env.COPILOT_API_KEY) {
    headers['x-api-key'] = env.COPILOT_API_KEY
  }

  try {
    const response = await fetch(`${SIM_AGENT_API_URL}/api/get-available-models`, {
      method: 'GET',
      headers,
      cache: 'no-store',
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      logger.warn('Failed to fetch available models from copilot backend', {
        status: response.status,
      })
      return NextResponse.json(
        {
          success: false,
          error: payload?.error || 'Failed to fetch available models',
          models: [],
        },
        { status: response.status }
      )
    }

    const rawModels = Array.isArray(payload?.models) ? payload.models : []
    const models: AvailableModel[] = rawModels
      .filter((item: any) => item && typeof item.id === 'string')
      .map((item: any) => ({
        id: item.id,
        friendlyName: item.friendlyName || item.displayName || item.id,
        provider: item.provider || 'unknown',
      }))

    return NextResponse.json({ success: true, models })
  } catch (error) {
    logger.error('Error fetching available models', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch available models',
        models: [],
      },
      { status: 500 }
    )
  }
}
