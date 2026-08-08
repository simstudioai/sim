import { getFileShareContract, upsertFileShareContract } from '@/lib/api/contracts/public-shares'
import {
  defineInternalJsonRoute,
  internalFileErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import {
  getWorkspaceFileShare,
  updateWorkspaceFileShare,
} from '@/lib/workspace-files/application/share-workspace-file'

export const dynamic = 'force-dynamic'

export const GET = defineInternalJsonRoute({
  contract: getFileShareContract,
  auth: internalSessionAuth,
  operation: fileOperations.readShare,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal share-read behavior' }),
  errorPolicy: internalFileErrorPolicy,
  mapInput: ({ params }) => ({ fileId: params.fileId, assertedWorkspaceId: params.id }),
  useCase: getWorkspaceFileShare,
  present: ({ share }) => ({ share }),
})

export const PUT = defineInternalJsonRoute({
  contract: upsertFileShareContract,
  auth: internalSessionAuth,
  operation: fileOperations.updateShare,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal share-update behavior',
  }),
  errorPolicy: internalFileErrorPolicy,
  mapInput: ({ params, body }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: params.id,
    isActive: body.isActive,
    authType: body.authType,
    password: body.password,
    allowedEmails: body.allowedEmails,
    token: body.token,
  }),
  useCase: updateWorkspaceFileShare,
  present: ({ share }) => ({ share }),
})
