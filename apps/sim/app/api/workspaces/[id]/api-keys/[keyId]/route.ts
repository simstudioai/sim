import {
  deleteWorkspaceApiKeyContract,
  updateWorkspaceApiKeyContract,
  workspaceApiKeyIdParamsSchema,
} from '@/lib/api/contracts/api-keys'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  renameWorkspaceApiKey,
  revokeWorkspaceApiKey,
  workspaceApiKeyOperations,
} from '@/lib/api-key/application/workspace-api-keys'
import { workspaceApiKeyErrorPolicy } from '@/lib/api-key/management-error-policy'

const rateLimit = internalRateLimits.none({
  reason: 'Preserve existing workspace-key management admission',
})
export const PUT = defineInternalJsonRoute({
  contract: updateWorkspaceApiKeyContract,
  auth: internalSessionAuth,
  operation: workspaceApiKeyOperations.rename,
  rateLimit,
  errorPolicy: workspaceApiKeyErrorPolicy('write'),
  beforeParse: async ({ principal, params }) => {
    const scope = workspaceApiKeyIdParamsSchema.parse(params)
    await renameWorkspaceApiKey.authorize({
      principal,
      input: { workspaceId: scope.id, keyId: scope.keyId, name: '' },
    })
  },
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    keyId: params.keyId,
    name: body.name,
  }),
  useCase: renameWorkspaceApiKey,
  present: ({ key }) => ({
    key: { ...key, createdAt: key.createdAt.toISOString(), updatedAt: key.updatedAt.toISOString() },
  }),
})
export const DELETE = defineInternalJsonRoute({
  contract: deleteWorkspaceApiKeyContract,
  auth: internalSessionAuth,
  operation: workspaceApiKeyOperations.revoke,
  rateLimit,
  errorPolicy: workspaceApiKeyErrorPolicy('write'),
  mapInput: ({ params }) => ({ workspaceId: params.id, keyId: params.keyId }),
  useCase: revokeWorkspaceApiKey,
  present: () => ({ success: true as const }),
})
