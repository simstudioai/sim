import { v2GetResourceManifestContract } from '@/lib/api/contracts/v2/resource-manifest'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { workflowCodeOperations } from '@/lib/workflows/code/operations'
import { readResourceManifest } from '@/lib/workflows/code/resource-manifest'
import { catalogErrorPolicy } from '@/app/api/v2/lib/catalog'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/workspaces/{workspaceId}/resource-manifest — the tables, knowledge bases, credential
 * bindings, workflows and env names workflow source can name, by key. Answers 403 while the
 * `workflow-code` flag is off.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetResourceManifestContract,
  auth: v2ApiKeyAuth,
  operation: workflowCodeOperations.readResourceManifest,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: catalogErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.workspaceId }),
  useCase: readResourceManifest,
  present: (manifest) => ({ data: manifest }),
})
