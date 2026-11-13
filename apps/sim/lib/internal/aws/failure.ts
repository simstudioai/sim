import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { isRetryableNetworkError } from '@/lib/core/errors/retryable-infrastructure'

const THROTTLING_ERROR_NAMES = new Set(['Throttling', 'ThrottlingException'])

/**
 * Whether resolving a saved AWS credential failed because AWS was briefly unavailable rather
 * than because it denied the credential: an error STS models as retryable
 * (IDPCommunicationError, when STS could not reach Sim's OIDC issuer), throttling, an STS 5xx,
 * or a network failure. The SDK has already retried these.
 */
export function isTransientAwsFailure(error: unknown): boolean {
  if (!isRecordLike(error)) return false
  const status = isRecordLike(error.$metadata) ? error.$metadata.httpStatusCode : undefined
  return (
    error.$retryable !== undefined ||
    THROTTLING_ERROR_NAMES.has(String(error.name)) ||
    status === 429 ||
    (typeof status === 'number' && status >= 500) ||
    error.name === 'TimeoutError' ||
    isRetryableNetworkError(error)
  )
}

/** The caller-facing reason a saved AWS credential could not be used: the AWS message, never a key. */
export function awsCredentialFailureMessage(error: unknown): string {
  return `Could not use the AWS credential: ${getErrorMessage(error, 'Unknown error')}`
}
