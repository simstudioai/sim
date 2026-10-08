import { deleteSsoProviderContract, setPrimarySsoProviderContract } from '@/lib/api/contracts/auth'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalSsoErrorPolicy } from '@/lib/api/server/routes/sso'
import { ssoProviderOperations, ssoSettingsOperations } from '@/lib/auth/sso/application/operations'
import { deleteSsoProvider } from '@/lib/auth/sso/application/provider-settings'
import { setPrimarySsoProvider } from '@/lib/auth/sso/application/set-primary-provider'

export const PATCH = defineInternalJsonRoute({
  contract: setPrimarySsoProviderContract,
  auth: internalSessionAuth,
  operation: ssoSettingsOperations.setPrimary,
  rateLimit: internalRateLimits.user({ bucketName: 'sso-set-primary-provider' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ providerId: params.providerId }),
  useCase: setPrimarySsoProvider,
  present: ({ providerId }) => ({ success: true as const, providerId }),
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteSsoProviderContract,
  auth: internalSessionAuth,
  operation: ssoProviderOperations.delete,
  rateLimit: internalRateLimits.none({
    reason: 'Preserves the existing session-only SSO settings delete policy.',
  }),
  errorPolicy: internalSsoErrorPolicy,
  mapInput: ({ params }) => ({ providerId: params.providerId }),
  useCase: deleteSsoProvider,
  present: ({ providerId }) => ({ success: true as const, providerId }),
})
