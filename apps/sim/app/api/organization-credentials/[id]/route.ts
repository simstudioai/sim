import { updateOrganizationCredentialContract } from '@/lib/api/contracts/organization-credentials'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalCredentialErrorPolicy } from '@/lib/credentials/api/route-policies'
import {
  organizationCredentialOperations,
  updateOrganizationCredential,
} from '@/lib/credentials/application/organization-credentials'
import { toOrganizationCredential } from '@/lib/credentials/application/presentation'

export const PATCH = defineInternalJsonRoute({
  contract: updateOrganizationCredentialContract,
  auth: internalSessionAuth,
  operation: organizationCredentialOperations.update,
  rateLimit: internalRateLimits.none({ reason: 'Preserve credential update behavior' }),
  errorPolicy: internalCredentialErrorPolicy,
  mapInput: ({ body, params }) => ({ ...body, credentialId: params.id }),
  useCase: updateOrganizationCredential,
  present: ({ credential }) => ({ credential: toOrganizationCredential(credential) }),
})
