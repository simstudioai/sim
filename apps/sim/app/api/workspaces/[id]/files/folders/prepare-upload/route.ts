import { prepareUploadFoldersContract } from '@/lib/api/contracts/workspace-file-folder-upload'
import {
  defineInternalJsonRoute,
  internalJsonPresenters,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalFileErrorPolicies } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { prepareUploadFoldersOperation } from '@/lib/workspace-files/application/prepare-upload-folders'

export const POST = defineInternalJsonRoute({
  contract: prepareUploadFoldersContract,
  auth: internalSessionAuth,
  operation: fileOperations.prepareUploadFolders,
  rateLimit: internalRateLimits.user({
    bucketName: 'file-folder-upload',
    config: { maxTokens: 20, refillRate: 10, refillIntervalMs: 60_000 },
  }),
  parseOptions: { maxBodyBytes: 1024 * 1024 },
  errorPolicy: internalFileErrorPolicies.default,
  mapInput: ({ params, body }) => ({ ...body, workspaceId: params.id }),
  useCase: prepareUploadFoldersOperation,
  present: internalJsonPresenters.withSuccess,
})
