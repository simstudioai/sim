import { v2GetSourceResourcesContract } from '@/lib/api/contracts/v2/source-resources'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { readSourceResources } from '@/lib/workflows/application/read-source-resources'
import { catalogErrorPolicy } from '@/app/api/v2/lib/catalog'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/workspaces/{workspaceId}/workflows/source/resources — the tables, knowledge bases,
 * credentials, workflows and env names workflow source can name, by key. Answers 403 while the
 * `workflow-code` flag is off.
 *
 * `headSafe: false` because listing a resource that has no key yet allocates one
 * (`workspace_resource_key`), so a `HEAD` probe must not run it.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetSourceResourcesContract,
  auth: v2ApiKeyAuth,
  headSafe: false,
  operation: workflowOperations.readSourceResources,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: catalogErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.workspaceId }),
  useCase: readSourceResources,
  present: (manifest) => ({ data: manifest }),
})
