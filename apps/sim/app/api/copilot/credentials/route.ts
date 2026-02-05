import { type NextRequest, NextResponse } from 'next/server'
import { authenticateCopilotRequestSessionOnly } from '@/lib/copilot/request-helpers'
import { routeExecution } from '@/lib/copilot/tools/server/router'

/**
 * GET /api/copilot/credentials
 * Returns connected OAuth credentials for the authenticated user.
 * Used by the copilot store for credential masking.
 */
export async function GET(_req: NextRequest) {
  const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
  if (!isAuthenticated || !userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await routeExecution('get_credentials', {}, { userId })
    return NextResponse.json({ success: true, result })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load credentials' },
      { status: 500 }
    )
  }
}

