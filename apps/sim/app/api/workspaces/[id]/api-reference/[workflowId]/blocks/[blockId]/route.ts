import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getApiReferenceBlockContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { redactSingleBlock, resolveReadablePublication } from '@/lib/workflows/api-reference'
import { loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'

const logger = createLogger('ApiReferenceBlockAPI')

/**
 * A single deployed block, redacted. Gated identically to the block list on
 * `exposeBlocks=true`; an unknown block id inside an exposed workflow is a 404.
 */
export const GET = withRouteHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string; workflowId: string; blockId: string }> }
  ) => {
    if (!(await isFeatureEnabled('api-reference-doc'))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(getApiReferenceBlockContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId, workflowId, blockId } = parsed.data.params

    const readable = await resolveReadablePublication(workflowId, session.user.id)
    if (!readable || readable.workspaceId !== workspaceId || !readable.publication.exposeBlocks) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    let block: ReturnType<typeof redactSingleBlock> = null
    try {
      const deployed = await loadDeployedWorkflowState(workflowId, workspaceId)
      block = redactSingleBlock(deployed.blocks, deployed.edges, blockId)
    } catch {
      logger.info('Block requested for undeployed publication', { workflowId, blockId })
    }
    if (!block) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    logger.info('Served redacted block', { workspaceId, workflowId, blockId })
    return NextResponse.json({ block })
  }
)
