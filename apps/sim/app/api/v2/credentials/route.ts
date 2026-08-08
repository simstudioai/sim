import { v2ListCredentialsContract } from '@/lib/api/contracts/v2/credentials'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { listWorkspaceCredentials } from '@/lib/credentials/application/list-workspace-credentials'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { toV2Credential } from '@/app/api/v2/credentials/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/credentials — List the credentials the caller can see in a workspace. */
export const GET = defineV2JsonRoute({
  contract: v2ListCredentialsContract,
  auth: v2ApiKeyAuth,
  operation: credentialOperations.listConnections,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ query }) => query,
  useCase: listWorkspaceCredentials,
  present: ({ credentials }) => ({
    data: credentials.map(toV2Credential),
    nextCursor: null,
  }),
})
