import {
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { getValidationErrorMessage, validationErrorResponse } from '@/lib/api/server/validation'
import { ADMISSION_RETRY_AFTER_SECONDS } from '@/lib/core/admission/transient-failure'
import { NoWorkspaceAccessError } from '@/lib/core/application'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { CredentialAccessRequiredError } from '@/lib/credentials/application/authorized-credential-use-case'
import { CredentialProviderOperationError } from '@/lib/credentials/application/credential-crud'

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
    if (!(error instanceof CredentialProviderOperationError)) return null
    if (!error.providerUnavailable) {
      return internalErrorResponse(400, { error: error.message, code: error.providerErrorCode })
    }
    return internalErrorResponse(
      503,
      { error: error.message, code: error.providerErrorCode },
      { 'Retry-After': ADMISSION_RETRY_AFTER_SECONDS.toString() }
    )
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
