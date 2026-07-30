import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getWorkspaceApiReferenceContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  type ApiReferenceDoc,
  deriveApiReferenceEntry,
  listReadablePublications,
  renderDocMarkdown,
  renderDocOpenApi,
} from '@/lib/workflows/api-reference'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceApiReferenceAPI')

/**
 * Emits the workspace's API reference doc: one entry per published workflow the
 * caller (any org member) may read. Structure is derived live from each workflow's
 * active deployment. `?format=markdown|openapi` renders alternate views. An
 * unauthenticated caller gets 401; everything else (feature off, no visible entries)
 * degrades to an empty or hidden result without leaking provider-workspace data.
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    if (!(await isFeatureEnabled('api-reference-doc'))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(getWorkspaceApiReferenceContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId } = parsed.data.params
    const { format } = parsed.data.query

    const publications = await listReadablePublications(workspaceId, session.user.id)
    // Null = reader is not a member of the workspace's org: 404, never leak existence.
    if (publications === null) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const entries = await Promise.all(
      publications.map((p) => deriveApiReferenceEntry(p.workflowRow, p.publication, p.workspaceId))
    )

    const workspace = await getWorkspaceWithOwner(workspaceId)
    const doc: ApiReferenceDoc = {
      workspaceId,
      name: workspace?.name ?? workspaceId,
      generatedAt: new Date().toISOString(),
      entries,
    }

    logger.info('Served workspace API reference', {
      workspaceId,
      entryCount: entries.length,
      format,
    })

    if (format === 'markdown') {
      return new NextResponse(renderDocMarkdown(doc), {
        headers: { 'content-type': 'text/markdown; charset=utf-8' },
      })
    }
    if (format === 'openapi') {
      return NextResponse.json(renderDocOpenApi(doc))
    }
    return NextResponse.json(doc)
  }
)
