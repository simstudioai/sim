import {
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { getValidationErrorMessage, validationErrorResponse } from '@/lib/api/server/validation'
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
