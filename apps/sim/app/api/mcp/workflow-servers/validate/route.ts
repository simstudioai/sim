import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { hasValidStartBlockInState } from '@/lib/workflows/triggers/trigger-utils'

const logger = createLogger('ValidateMcpWorkflowsAPI')

/**
 * POST /api/mcp/workflow-servers/validate
 * Validates if workflows have valid start blocks for MCP usage
 */
export async function POST(request: Request) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { workflowIds } = body

    if (!Array.isArray(workflowIds) || workflowIds.length === 0) {
      return NextResponse.json({ error: 'workflowIds must be a non-empty array' }, { status: 400 })
    }

    const results: Record<string, boolean> = {}

    for (const workflowId of workflowIds) {
      try {
        const state = await loadWorkflowFromNormalizedTables(workflowId)
        results[workflowId] = hasValidStartBlockInState(state)
      } catch (error) {
        logger.warn(`Failed to validate workflow ${workflowId}:`, error)
        results[workflowId] = false
      }
    }

    return NextResponse.json({ data: results })
  } catch (error) {
    logger.error('Failed to validate workflows for MCP:', error)
    return NextResponse.json({ error: 'Failed to validate workflows' }, { status: 500 })
  }
}
