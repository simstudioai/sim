import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { SIM_AGENT_API_URL_DEFAULT } from '@/lib/sim-agent'

const logger = createLogger('YamlHealthAPI')

// Sim Agent API configuration
const SIM_AGENT_API_URL = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT

export async function GET() {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    logger.info(`[${requestId}] Checking YAML service health`)

    // Check sim-agent health
    const response = await fetch(`${SIM_AGENT_API_URL}/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const isHealthy = response.ok

    return NextResponse.json({
      success: true,
      healthy: isHealthy,
      service: 'yaml',
    })
  } catch (error) {
    logger.error(`[${requestId}] YAML health check failed:`, error)

    return NextResponse.json(
      {
        success: false,
        healthy: false,
        service: 'yaml',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
