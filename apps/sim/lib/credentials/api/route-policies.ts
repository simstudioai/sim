import type { NextResponse } from 'next/server'
import {
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { getValidationErrorMessage, validationErrorResponse } from '@/lib/api/server/validation'
import { ADMISSION_RETRY_AFTER_SECONDS } from '@/lib/core/admission/transient-failure'
import { NoWorkspaceAccessError } from '@/lib/core/application'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { OrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { CredentialGroupEnrollmentError } from '@/lib/credential-groups/enrollments'
import {
  CredentialGroupOAuthError,
  CredentialGroupProviderConfigurationError,
} from '@/lib/credential-groups/provider-adapter'
import { CredentialAccessRequiredError } from '@/lib/credentials/application/authorized-credential-use-case'
import { CredentialProviderOperationError } from '@/lib/credentials/application/crud'
import {
  OAuthDisconnectConfigurationError,
  OAuthDisconnectLimitError,
  OAuthDisconnectPartialFailureError,
  OAuthProviderRevocationError,
} from '@/lib/credentials/oauth-accounts'
import { KeylessCredentialRefusedError } from '@/lib/credentials/workload-identity/subject'
import { v2Error, v2ErrorForOrchestration } from '@/app/api/v2/lib/response'

/**
 * The v2 rendering of a refused credential. A keyless refusal names its cause
 * in `details.code`, the field every v2 application error code uses; a
 * provider rejection keeps its published `details.providerErrorCode`, and a
 * provider outage is `503`.
 */
export function renderV2CredentialProviderError(error: unknown): NextResponse | null {
  if (error instanceof KeylessCredentialRefusedError) {
    return v2ErrorForOrchestration(error.code, error.message, { code: error.detailCode })
  }
  if (!(error instanceof CredentialProviderOperationError)) return null
  if (error.providerUnavailable) {
    return v2Error('SERVICE_UNAVAILABLE', 'Credential provider is temporarily unavailable')
  }
  return v2Error('BAD_REQUEST', error.message, {
    details: { providerErrorCode: error.providerErrorCode },
  })
}

export const credentialValidationParseOptions = {
  validationErrorResponse: (error: Parameters<typeof getValidationErrorMessage>[0]) =>
    validationErrorResponse(error, getValidationErrorMessage(error)),
} as const

/**
 * A provider that could not be reached while a secret was verified is `503 +
 * Retry-After`, matching `statusForCredentialOrchestrationError` and the v2
 * surface. All three used to disagree — 502 here, 502 there, 503 on v2 — which
 * left the same failure looking like three different things depending on which
 * surface the caller used, and only one of them said when to come back.
 */
export const internalCredentialErrorPolicy = extendInternalErrorPolicy(
  internalOrchestrationErrorPolicy,
  (error) => {
    const disconnectError =
      error instanceof OAuthDisconnectPartialFailureError ? error.cause : error
    if (disconnectError instanceof OAuthDisconnectConfigurationError) {
      return internalErrorResponse(400, { error: disconnectError.message })
    }
    if (error instanceof OAuthDisconnectLimitError) {
      return internalErrorResponse(400, { error: error.message })
    }
    const revocationError =
      disconnectError instanceof OAuthProviderRevocationError ? disconnectError : null
    if (revocationError) {
      return internalErrorResponse(
        503,
        { error: revocationError.message },
        { 'Retry-After': ADMISSION_RETRY_AFTER_SECONDS.toString() }
      )
    }
    if (error instanceof KeylessCredentialRefusedError) {
      return internalErrorResponse(statusForOrchestrationError(error.code), {
        error: error.message,
        code: error.detailCode,
      })
    }
    if (!(error instanceof CredentialProviderOperationError)) return null
    if (!error.providerUnavailable) {
      return internalErrorResponse(400, {
        error: error.message,
        code: error.providerErrorCode,
      })
    }
    return internalErrorResponse(
      503,
      { error: error.message, code: error.providerErrorCode },
      { 'Retry-After': ADMISSION_RETRY_AFTER_SECONDS.toString() }
    )
  }
)

/** Presents actionable account setup failures without exposing provider transport errors. */
export const internalPersonalCredentialConnectionErrorPolicy = extendInternalErrorPolicy(
  internalCredentialErrorPolicy,
  (error) => {
    if (error instanceof CredentialGroupProviderConfigurationError) {
      return internalErrorResponse(409, {
        error: 'Ask an organization admin to configure this integration in organization settings',
      })
    }
    const status =
      error instanceof CredentialGroupOAuthError
        ? error.statusCode
        : error instanceof CredentialGroupEnrollmentError
          ? error.status
          : null
    if (status === null || !(error instanceof Error)) return null
    if (status >= 500)
      return internalErrorResponse(503, {
        error: 'Account sign-in is temporarily unavailable. Please try again.',
      })
    return internalErrorResponse(status, { error: error.message })
  }
)

export const internalCredentialDetailErrorPolicy = extendInternalErrorPolicy(
  internalCredentialErrorPolicy,
  (error) =>
    error instanceof CredentialAccessRequiredError
      ? internalErrorResponse(403, { error: 'Forbidden' })
      : null
)

export const internalCredentialMemberListErrorPolicy = extendInternalErrorPolicy(
  internalCredentialErrorPolicy,
  (error) => {
    if (
      error instanceof NoWorkspaceAccessError ||
      (error instanceof OrchestrationError && error.code === 'not_found')
    ) {
      return internalErrorResponse(404, { error: 'Not found' })
    }
    return null
  }
)

export const internalCredentialMemberMutationErrorPolicy = extendInternalErrorPolicy(
  internalCredentialErrorPolicy,
  (error) => {
    if (
      error instanceof NoWorkspaceAccessError ||
      (error instanceof ForbiddenOperationError &&
        error.detailCode === 'CREDENTIAL_ADMIN_ACCESS_REQUIRED') ||
      (error instanceof OrchestrationError && error.code === 'not_found')
    ) {
      return internalErrorResponse(403, { error: 'Admin access required' })
    }
    return null
  }
)
