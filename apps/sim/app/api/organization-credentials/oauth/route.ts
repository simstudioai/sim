import { listOrganizationOAuthCredentialsContract } from '@/lib/api/contracts/organization-credentials'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalCredentialErrorPolicy } from '@/lib/credentials/api/route-policies'
import {
  listOrganizationOAuthCredentials,
  organizationCredentialOperations,
} from '@/lib/credentials/application/organization-credentials'

export const GET = defineInternalJsonRoute({
  contract: listOrganizationOAuthCredentialsContract,
  auth: internalSessionAuth,
  operation: organizationCredentialOperations.list,
  rateLimit: internalRateLimits.none({ reason: 'Preserve OAuth credential listing behavior' }),
  errorPolicy: internalCredentialErrorPolicy,
  mapInput: ({ query }) => ({ ...query, type: 'oauth' as const }),
  useCase: listOrganizationOAuthCredentials,
})
