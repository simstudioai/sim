import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getWorkflowApiReferenceContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  deriveApiReferenceEntry,
  renderEntryMarkdown,
  resolveReadablePublication,
} from '@/lib/workflows/api-reference'

const logger = createLogger('WorkflowApiReferenceAPI')

/**
 * A single published workflow's reference entry. Denials — unknown/archived workflow,
 * unpublished, caller not in the org, allowlist miss, or a workflow that does not live
 * in the `{id}` workspace — all return 404, never 403, so existence never leaks.
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

    const parsed = await parseRequest(getWorkflowApiReferenceContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId, workflowId } = parsed.data.params
    const { format } = parsed.data.query

    const readable = await resolveReadablePublication(workflowId, session.user.id)
    if (!readable || readable.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const entry = await deriveApiReferenceEntry(
      readable.workflowRow,
      readable.publication,
      readable.workspaceId
    )

    logger.info('Served workflow API reference entry', { workspaceId, workflowId, format })

    if (format === 'markdown') {
      return new NextResponse(renderEntryMarkdown(entry), {
        headers: { 'content-type': 'text/markdown; charset=utf-8' },
      })
    }
    return NextResponse.json(entry)
  }
)
