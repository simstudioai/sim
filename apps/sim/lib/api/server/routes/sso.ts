import { APIError } from 'better-auth/api'
import {
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes/internal-json-route'
import { v2OrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import type { V2ErrorPolicy } from '@/lib/api/server/routes/v2-json-route'
import { SsoProviderSettingsError } from '@/lib/auth/sso/application/provider-registration'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { OrganizationMembershipNotFoundError } from '@/lib/core/application/organization-authorization'
import { DomainVerificationLookupError } from '@/lib/organizations/application/domain-settings'
import { v2Error } from '@/app/api/v2/lib/response'

/** Preserves actionable domain verification and identity-provider validation failures. */
export const v2SsoErrorPolicy: V2ErrorPolicy = {
  render(error) {
    if (error instanceof APIError) {
      if (error.statusCode === 503)
        return v2Error(
          'SERVICE_UNAVAILABLE',
          'Identity provider settings are temporarily unavailable'
        )
      if (error.statusCode >= 500) return v2Error('INTERNAL_ERROR', 'Internal server error')
      if (error.statusCode === 409)
        return v2Error(
          'CONFLICT',
          error.body?.message ?? 'Identity provider configuration conflicts'
        )
      if (error.statusCode === 403)
        return v2Error(
          'FORBIDDEN',
          error.body?.message ?? 'Identity provider configuration is not permitted',
          {
            details: {
              code:
                error.body?.message === 'You have reached the maximum number of SSO providers' ||
                error.body?.message === 'SSO provider registration is disabled'
                  ? 'SSO_PROVIDER_LIMIT_REACHED'
                  : 'ORGANIZATION_ADMIN_REQUIRED',
            },
          }
        )
      if (error.statusCode === 404) return v2Error('NOT_FOUND', 'Provider not found')
      return v2Error(
        'BAD_REQUEST',
        error.body?.message ?? 'Invalid identity provider configuration'
      )
    }
    if (error instanceof DomainVerificationLookupError) {
      return error.status === 503
        ? v2Error('SERVICE_UNAVAILABLE', 'DNS verification is temporarily unavailable')
        : v2Error('BAD_REQUEST', error.message)
    }
    if (error instanceof SsoProviderSettingsError) {
      return v2Error(
        error.status === 409 ? 'CONFLICT' : error.status === 403 ? 'FORBIDDEN' : 'BAD_REQUEST',
        error.message,
        error.reason ? { details: { code: error.reason } } : undefined
      )
    }
    return v2OrganizationErrorPolicy.render(error)
  },
}

/** Retains the settings UI's actionable SSO error codes and provider validation messages. */
export const internalSsoErrorPolicy = extendInternalErrorPolicy(
  internalOrchestrationErrorPolicy,
  (error) => {
    if (error instanceof OrganizationMembershipNotFoundError)
      return internalErrorResponse(403, { error: 'Forbidden' })
    if (error instanceof ForbiddenOperationError)
      return internalErrorResponse(403, {
        error: error.message,
        ...(error.detailCode === 'SSO_DOMAIN_NOT_VERIFIED' ? { code: error.detailCode } : {}),
      })
    if (error instanceof SsoProviderSettingsError)
      return internalErrorResponse(error.status, {
        error: error.message,
        ...(error.reason ? { code: error.reason } : {}),
      })
    if (error instanceof APIError)
      return internalErrorResponse(error.statusCode, {
        error: error.body?.message ?? 'Failed to save the SSO provider',
      })
    return null
  }
)
