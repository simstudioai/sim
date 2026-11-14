import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { isRetryableNetworkError } from '@/lib/core/errors/retryable-infrastructure'
import { EGRESS_UNAVAILABLE_MESSAGE, isUnavailableFailure } from '@/lib/core/orchestration/types'

const THROTTLING_ERROR_NAMES = new Set(['Throttling', 'ThrottlingException'])

/**
 * Whether resolving a saved AWS credential failed because AWS was briefly unavailable rather
 * than because it denied the credential: an error STS models as retryable
 * (IDPCommunicationError, when STS could not reach Sim's OIDC issuer), throttling, an STS 5xx,
 * a network failure, or the organization's egress route refusing or failing the connection.
 * The SDK has already retried these.
 */
export function isTransientAwsFailure(error: unknown): boolean {
  if (isUnavailableFailure(error)) return true
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

/**
 * The caller-facing reason a saved AWS credential could not be used: the AWS message, never a key.
 * An egress outage is Sim's, not the credential's, so it reads as that and never names its routing code.
 */
export function awsCredentialFailureMessage(error: unknown): string {
  if (isUnavailableFailure(error)) return EGRESS_UNAVAILABLE_MESSAGE
  return `Could not use the AWS credential: ${getErrorMessage(error, 'Unknown error')}`
}
