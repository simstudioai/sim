import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { listOpenCodeRepositories } from '@/lib/opencode/service'

const logger = createLogger('OpenCodeReposToolAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized OpenCode repos request`)
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 })
    }

    await request.text()
    const repositories = await listOpenCodeRepositories()

    return NextResponse.json({
      success: true,
      output: {
        repositories,
        count: repositories.length,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Failed to fetch OpenCode repositories`, { error })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch repositories' },
      { status: 500 }
    )
  }
}
