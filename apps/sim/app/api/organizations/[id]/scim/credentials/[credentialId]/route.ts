import { revokeScimCredentialContract } from '@/lib/api/contracts/organization-scim'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { revokeScimCredential } from '@/ee/scim/lib/application/admin/credentials'

export const DELETE = defineInternalJsonRoute({
  contract: revokeScimCredentialContract,
  auth: internalSessionAuth,
  operation: revokeScimCredential.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'scim-credential-revoke' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({
    organizationId: params.id,
    credentialId: params.credentialId,
  }),
  useCase: revokeScimCredential,
  present: ({ success }) => ({ success }),
})
