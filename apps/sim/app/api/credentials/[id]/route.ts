import {
  deleteWorkspaceCredentialContract,
  getWorkspaceCredentialContract,
  updateWorkspaceCredentialContract,
} from '@/lib/api/contracts/credentials'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  credentialValidationParseOptions,
  internalCredentialDetailErrorPolicy,
  internalCredentialErrorPolicy,
} from '@/lib/credentials/api/route-policies'
import {
  getWorkspaceCredentialUseCase,
  updateWorkspaceCredentialUseCase,
} from '@/lib/credentials/application/credential-crud'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { toWorkspaceCredential } from '@/lib/credentials/application/presentation'
import { deleteCredentialUseCase } from '@/lib/credentials/application/service-account'

const rateLimit = internalRateLimits.none({ reason: 'Preserve existing internal behavior' })

export const GET = defineInternalJsonRoute({
  contract: getWorkspaceCredentialContract,
  auth: internalSessionAuth,
  operation: credentialOperations.read,
  rateLimit,
  errorPolicy: internalCredentialDetailErrorPolicy,
  parseOptions: credentialValidationParseOptions,
  mapInput: ({ params, query }) => ({
    credentialId: params.id,
    ...(query.workspaceId ? { assertedWorkspaceId: query.workspaceId } : {}),
  }),
  useCase: getWorkspaceCredentialUseCase,
  present: ({ credential, access }) => ({
    credential: toWorkspaceCredential(credential, access),
  }),
})

export const PUT = defineInternalJsonRoute({
  contract: updateWorkspaceCredentialContract,
  auth: internalSessionAuth,
  operation: credentialOperations.update,
  rateLimit,
  errorPolicy: internalCredentialErrorPolicy,
  parseOptions: credentialValidationParseOptions,
  mapInput: ({ params, body, query }) => ({
    credentialId: params.id,
    ...body,
    ...(query.workspaceId ? { assertedWorkspaceId: query.workspaceId } : {}),
  }),
  useCase: updateWorkspaceCredentialUseCase,
  present: ({ credential, access }) => ({
    credential: toWorkspaceCredential(credential, access),
  }),
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteWorkspaceCredentialContract,
  auth: internalSessionAuth,
  operation: credentialOperations.delete,
  rateLimit,
  errorPolicy: internalCredentialErrorPolicy,
  parseOptions: credentialValidationParseOptions,
  mapInput: ({ params, query }) => ({
    credentialId: params.id,
    ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
  }),
  useCase: deleteCredentialUseCase,
  present: () => ({ success: true as const }),
})
