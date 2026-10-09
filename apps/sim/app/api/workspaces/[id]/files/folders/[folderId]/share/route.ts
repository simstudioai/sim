import {
  getFolderShareContract,
  upsertFolderShareContract,
} from '@/lib/api/contracts/public-shares'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalFileErrorPolicies } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import {
  getWorkspaceFileFolderShare,
  updateWorkspaceFileFolderShare,
} from '@/lib/workspace-files/application/share-workspace-file-folder'

export const dynamic = 'force-dynamic'

export const GET = defineInternalJsonRoute({
  contract: getFolderShareContract,
  auth: internalSessionAuth,
  operation: fileOperations.readFolderShare,
  rateLimit: internalRateLimits.none({
    reason: 'Same authenticated settings read as file sharing',
  }),
  errorPolicy: internalFileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params }) => ({ workspaceId: params.id, folderId: params.folderId }),
  useCase: getWorkspaceFileFolderShare,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})

export const PUT = defineInternalJsonRoute({
  contract: upsertFolderShareContract,
  auth: internalSessionAuth,
  operation: fileOperations.updateFolderShare,
  rateLimit: internalRateLimits.user({ bucketName: 'workspace-folder-sharing' }),
  errorPolicy: internalFileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, body }) => ({ workspaceId: params.id, folderId: params.folderId, ...body }),
  useCase: updateWorkspaceFileFolderShare,
  present: ({ share }) => ({ share }),
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
