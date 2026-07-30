import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getOrgResourcesContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  type ApiReferenceEntry,
  deriveApiReferenceEntry,
  listOrgReadableResources,
} from '@/lib/workflows/api-reference'

const logger = createLogger('OrgResourcesAPI')

interface CatalogService {
  workspaceId: string
  workspaceName: string
  resources: Array<ApiReferenceEntry & { resourceType: 'workflow'; workspaceId: string }>
}

/**
 * The org API catalog ("Org Resources"): every published resource across the caller's
 * organization that they're allowed to read, grouped by workspace (service). A caller
 * who is not a member of the org gets 404 - never a list, never existence. This is the
 * consumer counterpart to a workspace's publish action.
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

    const parsed = await parseRequest(getOrgResourcesContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: organizationId } = parsed.data.params

    const readable = await listOrgReadableResources(organizationId, session.user.id)
    if (readable === null) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Group by workspace-as-service, deriving each entry's live contract.
    const byWorkspace = new Map<string, CatalogService>()
    for (const r of readable) {
      const entry = await deriveApiReferenceEntry(r.workflowRow, r.publication, r.workspaceId)
      let service = byWorkspace.get(r.workspaceId)
      if (!service) {
        service = { workspaceId: r.workspaceId, workspaceName: r.workspaceName, resources: [] }
        byWorkspace.set(r.workspaceId, service)
      }
      service.resources.push({ ...entry, resourceType: 'workflow', workspaceId: r.workspaceId })
    }

    const services = [...byWorkspace.values()].sort((a, b) =>
      a.workspaceName.localeCompare(b.workspaceName)
    )

    logger.info('Served org resources catalog', {
      organizationId,
      serviceCount: services.length,
      resourceCount: readable.length,
    })

    return NextResponse.json({
      organizationId,
      generatedAt: new Date().toISOString(),
      services,
    })
  }
)
