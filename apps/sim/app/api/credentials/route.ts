import {
  createWorkspaceCredentialContract,
  listWorkspaceCredentialsContract,
} from '@/lib/api/contracts/credentials'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  credentialValidationParseOptions,
  internalCredentialErrorPolicy,
} from '@/lib/credentials/api/route-policies'
import {
  createWorkspaceCredential,
  listInternalCredentials,
} from '@/lib/credentials/application/credential-crud'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { toWorkspaceCredential } from '@/lib/credentials/application/presentation'

export const GET = defineInternalJsonRoute({
  contract: listWorkspaceCredentialsContract,
  auth: internalSessionAuth,
  operation: credentialOperations.listInternal,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal behavior' }),
  errorPolicy: internalCredentialErrorPolicy,
  parseOptions: credentialValidationParseOptions,
  mapInput: ({ query }) => query,
  useCase: listInternalCredentials,
  present: (result) =>
    result.mode === 'lookup'
      ? { credential: result.credential }
      : { credentials: result.credentials.map((row) => toWorkspaceCredential(row)) },
})

export const POST = defineInternalJsonRoute({
  contract: createWorkspaceCredentialContract,
  auth: internalSessionAuth,
  operation: credentialOperations.create,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal behavior' }),
  errorPolicy: internalCredentialErrorPolicy,
  parseOptions: credentialValidationParseOptions,
  mapInput: ({ body }) => body,
  useCase: createWorkspaceCredential,
  present: ({ credential, role, status }) => ({
    credential: { ...toWorkspaceCredential({ ...credential, role }), status },
  }),
  statusForResult: ({ created }) => (created ? 201 : 200),
})
