import {
  type V2WorkflowVersionDetail,
  v2GetWorkflowVersionContract,
} from '@/lib/api/contracts/v2/workflows'
import { getWorkflowDeploymentVersion } from '@/lib/workflows/persistence/utils'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { v2Data, v2Error } from '@/app/api/v2/lib/response'
import { resolveV2WorkflowTarget } from '@/app/api/v2/workflows/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/workflows/[id]/versions/[version] — Fetch one deployment version
 * and the workflow state it pins.
 */
export const GET = withPublicApiRouteHandler({
  contract: v2GetWorkflowVersionContract,
  rateLimitEndpoint: 'workflow-version-detail',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { id, version } = input.params

    const target = await resolveV2WorkflowTarget(rateLimit, userId, id)
    if (!target) return v2Error('NOT_FOUND', 'Workflow not found')

    const row = await getWorkflowDeploymentVersion(id, version)
    if (!row?.state) return v2Error('NOT_FOUND', 'Deployment version not found')

    const detail: V2WorkflowVersionDetail = {
      id: row.id,
      version: row.version,
      name: row.name,
      description: row.description,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      state: row.state as V2WorkflowVersionDetail['state'],
    }

    return v2Data(detail, { rateLimit })
  },
})
