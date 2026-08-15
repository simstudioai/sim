import {
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { getValidationErrorMessage, validationErrorResponse } from '@/lib/api/server/validation'
import { NoWorkspaceAccessError } from '@/lib/core/application'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { CredentialAccessRequiredError } from '@/lib/credentials/application/authorized-credential-use-case'
import { CredentialProviderOperationError } from '@/lib/credentials/application/credential-crud'

export const credentialValidationParseOptions = {
  validationErrorResponse: (error: Parameters<typeof getValidationErrorMessage>[0]) =>
    validationErrorResponse(error, getValidationErrorMessage(error)),
} as const

export const internalCredentialErrorPolicy = extendInternalErrorPolicy(
  internalOrchestrationErrorPolicy,
  (error) => {
    if (!(error instanceof CredentialProviderOperationError)) return null
    return internalErrorResponse(error.providerUnavailable ? 502 : 400, {
      error: error.message,
      code: error.providerErrorCode,
    })
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
