import { NextResponse } from 'next/server'
import { ssoRegistrationContract } from '@/lib/api/contracts/auth'
import { getValidationErrorMessage } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalSsoErrorPolicy } from '@/lib/api/server/routes/sso'
import { ssoProviderOperations } from '@/lib/auth/sso/application/operations'
import { saveSsoProvider } from '@/lib/auth/sso/application/provider-registration'

export const POST = defineInternalJsonRoute({
  contract: ssoRegistrationContract,
  auth: internalSessionAuth,
  operation: ssoProviderOperations.save,
  rateLimit: internalRateLimits.none({
    reason: 'Preserves the existing session-only SSO settings write policy.',
  }),
  errorPolicy: internalSsoErrorPolicy,
  parseOptions: {
    validationErrorResponse: (error) =>
      NextResponse.json(
        { error: getValidationErrorMessage(error, 'Validation failed') },
        { status: 400 }
      ),
  },
  mapInput: ({ body: { orgId, ...configuration } }) => ({
    organizationId: orgId,
    ...configuration,
  }),
  useCase: saveSsoProvider,
  present: ({ providerId, providerType, message }) => ({
    success: true as const,
    providerId,
    providerType,
    message,
  }),
})
