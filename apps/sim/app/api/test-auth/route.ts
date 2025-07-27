import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { simAgentClient } from '@/lib/sim-agent/client'

const logger = createLogger('TestAuthAPI')

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    // Get session for user info
    const session = await getSession()
    const body = await request.json()
    const { workflowId, userId } = body

    if (!workflowId) {
      return NextResponse.json(
        { success: false, error: 'Workflow ID is required' },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Test auth request`, {
      workflowId,
      userId: userId || session?.user?.id,
      hasSession: !!session,
    })

    // Use the sim-agent client - only send data, no cookies
    const result = await simAgentClient.testAuth({
      workflowId,
      userId: userId || session?.user?.id,
    })

    logger.info(`[${requestId}] Sim-agent response`, {
      success: result.success,
      status: result.status,
      hasData: !!result.data,
    })

    return NextResponse.json(result, { 
      status: result.success ? 200 : (result.status || 500) 
    })

  } catch (error) {
    logger.error(`[${requestId}] Test auth API failed:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
} 