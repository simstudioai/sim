import { createCredentialDraftContract } from '@/lib/api/contracts/credentials'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  credentialValidationParseOptions,
  internalCredentialErrorPolicy,
} from '@/lib/credentials/api/route-policies'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { saveCredentialDraft } from '@/lib/credentials/application/save-credential-draft'

export const POST = defineInternalJsonRoute({
  contract: createCredentialDraftContract,
  auth: internalSessionAuth,
  operation: credentialOperations.saveDraft,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal behavior' }),
  errorPolicy: internalCredentialErrorPolicy,
  parseOptions: credentialValidationParseOptions,
  mapInput: ({ body }) => body,
  useCase: saveCredentialDraft,
})
