import { v2GetFileShareContract, v2UpsertFileShareContract } from '@/lib/api/contracts/v2/files'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import {
  getWorkspaceFileShare,
  updateWorkspaceFileShare,
} from '@/lib/workspace-files/application/share-workspace-file'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = defineV2JsonRoute({
  contract: v2GetFileShareContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.readShare,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, query }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: getWorkspaceFileShare,
  present: ({ share }) => ({ data: share }),
})

export const PATCH = defineV2JsonRoute({
  contract: v2UpsertFileShareContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.updateShare,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, body }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: body.workspaceId,
    isActive: body.isActive,
    authType: body.authType,
    password: body.password,
    allowedEmails: body.allowedEmails,
  }),
  useCase: updateWorkspaceFileShare,
  present: ({ share }) => ({ data: share }),
})
