import { v2ShareFileContract, v2UnshareFileContract } from '@/lib/api/contracts/v2/files'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import {
  unshareWorkspaceFile,
  updateWorkspaceFileShare,
} from '@/lib/workspace-files/application/share-workspace-file'
import { toV2DisabledFileSharing, toV2EnabledFileSharing } from '@/app/api/v2/files/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const PUT = defineV2JsonRoute({
  contract: v2ShareFileContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.updateShare,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, body }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: body.workspaceId,
    isActive: true,
    authType: body.authType,
    password: body.password,
    allowedEmails: body.allowedEmails,
  }),
  useCase: updateWorkspaceFileShare,
  present: ({ share }) => ({ data: { sharing: toV2EnabledFileSharing(share) } }),
})

export const DELETE = defineV2JsonRoute({
  contract: v2UnshareFileContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.updateShare,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, query }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: unshareWorkspaceFile,
  present: ({ share }) => ({ data: { sharing: toV2DisabledFileSharing(share) } }),
})
