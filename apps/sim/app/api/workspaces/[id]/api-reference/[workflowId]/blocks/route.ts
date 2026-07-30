import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { listApiReferenceBlocksContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { redactBlocks, resolveReadablePublication } from '@/lib/workflows/api-reference'
import { loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'

const logger = createLogger('ApiReferenceBlocksAPI')

/**
 * Read-only, credential-redacted structural introspection of a published workflow's
 * deployed blocks. Available only when the provider set `exposeBlocks=true`; otherwise
 * 404 (same as any other denial). Config values are allowlisted to non-secret selectors
 * only — see `redactBlocks`.
 */
export const GET = withRouteHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string; workflowId: string }> }
  ) => {
    if (!(await isFeatureEnabled('api-reference-doc'))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(listApiReferenceBlocksContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId, workflowId } = parsed.data.params

    const readable = await resolveReadablePublication(workflowId, session.user.id)
    if (!readable || readable.workspaceId !== workspaceId || !readable.publication.exposeBlocks) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    let blocks: ReturnType<typeof redactBlocks> = []
    try {
      const deployed = await loadDeployedWorkflowState(workflowId, workspaceId)
      blocks = redactBlocks(deployed.blocks, deployed.edges)
    } catch {
      logger.info('Blocks requested for undeployed publication', { workflowId })
    }

    logger.info('Served redacted block list', { workspaceId, workflowId, count: blocks.length })
    return NextResponse.json({ blocks })
  }
)
