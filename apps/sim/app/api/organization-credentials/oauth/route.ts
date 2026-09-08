import { listOrganizationOAuthCredentialsContract } from '@/lib/api/contracts/organization-credentials'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalCredentialErrorPolicy } from '@/lib/credentials/api/route-policies'
import {
  listOrganizationCredentials,
  organizationCredentialOperations,
} from '@/lib/credentials/application/organization-credentials'
import type { OAuthProvider } from '@/lib/oauth/types'

export const GET = defineInternalJsonRoute({
  contract: listOrganizationOAuthCredentialsContract,
  auth: internalSessionAuth,
  operation: organizationCredentialOperations.list,
  rateLimit: internalRateLimits.none({ reason: 'Preserve OAuth credential listing behavior' }),
  errorPolicy: internalCredentialErrorPolicy,
  mapInput: ({ query }) => ({ ...query, type: 'oauth' as const }),
  useCase: listOrganizationCredentials,
  present: ({ credentials }) => ({
    credentials: credentials.map((row) => ({
      id: row.id,
      name: row.displayName,
      provider: row.providerId as OAuthProvider,
      type: 'oauth' as const,
    })),
  }),
})
