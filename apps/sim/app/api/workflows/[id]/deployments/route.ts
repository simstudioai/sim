import { listDeploymentVersionsContract } from '@/lib/api/contracts/deployments'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { createInternalWorkflowErrorPolicy } from '@/lib/workflows/api'
import { listWorkflowVersions } from '@/lib/workflows/application/list-workflow-versions'
import { workflowOperations } from '@/lib/workflows/application/operations'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = defineInternalJsonRoute({
  contract: listDeploymentVersionsContract,
  operation: workflowOperations.listVersions,
  useCase: listWorkflowVersions,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated workspace UI version lists retain their existing admission policy.',
  }),
  errorPolicy: createInternalWorkflowErrorPolicy('Failed to list deployments'),
  mapInput: ({ params }) => ({ workflowId: params.id }),
  present: ({ versions }) => ({
    versions: versions.map(({ deployedByName, ...version }) => ({
      ...version,
      createdAt: version.createdAt.toISOString(),
      deployedBy: deployedByName,
    })),
  }),
})
