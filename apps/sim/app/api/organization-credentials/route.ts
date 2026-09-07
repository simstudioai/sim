import {
  createOrganizationCredentialContract,
  listOrganizationCredentialsContract,
} from '@/lib/api/contracts/organization-credentials'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalCredentialErrorPolicy } from '@/lib/credentials/api/route-policies'
import {
  createOrganizationCredential,
  listOrganizationCredentials,
  organizationCredentialOperations,
} from '@/lib/credentials/application/organization-credentials'
import { toOrganizationCredential } from '@/lib/credentials/application/presentation'

export const GET = defineInternalJsonRoute({
  contract: listOrganizationCredentialsContract,
  auth: internalSessionAuth,
  operation: organizationCredentialOperations.list,
  rateLimit: internalRateLimits.none({ reason: 'Preserve credential listing behavior' }),
  errorPolicy: internalCredentialErrorPolicy,
  mapInput: ({ query }) => query,
  useCase: listOrganizationCredentials,
  present: ({ credentials }) => ({ credentials: credentials.map(toOrganizationCredential) }),
})
export const POST = defineInternalJsonRoute({
  contract: createOrganizationCredentialContract,
  auth: internalSessionAuth,
  operation: organizationCredentialOperations.create,
  rateLimit: internalRateLimits.none({ reason: 'Preserve credential creation behavior' }),
  errorPolicy: internalCredentialErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: createOrganizationCredential,
  present: ({ credential }) => ({ credential: toOrganizationCredential(credential) }),
  statusForResult: ({ created }) => (created ? 201 : 200),
})
