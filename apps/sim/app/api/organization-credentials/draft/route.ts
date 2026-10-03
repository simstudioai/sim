import { createOrganizationCredentialDraftContract } from '@/lib/api/contracts/organization-credentials'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalCredentialErrorPolicy } from '@/lib/credentials/api/route-policies'
import {
  organizationCredentialOperations,
  saveOrganizationCredentialDraft,
} from '@/lib/credentials/application/organization-credentials'

export const POST = defineInternalJsonRoute({
  contract: createOrganizationCredentialDraftContract,
  auth: internalSessionAuth,
  operation: organizationCredentialOperations.saveDraft,
  rateLimit: internalRateLimits.none({ reason: 'Preserve OAuth draft behavior' }),
  errorPolicy: internalCredentialErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: saveOrganizationCredentialDraft,
  present: (result) => result,
})
