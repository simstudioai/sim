import { ADMISSION_ERROR_CODE } from '@/lib/core/admission/transient-failure'

/**
 * Stable codes for admission refusals that the caller's billing or account state
 * decides, carried on the preprocessing error next to `WORKFLOW_NOT_DEPLOYED_CODE`.
 */
export const ADMISSION_REJECTION_CODE = {
  USAGE_LIMIT_EXCEEDED: 'USAGE_LIMIT_EXCEEDED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  BILLING_ACCOUNT_REQUIRED: 'BILLING_ACCOUNT_REQUIRED',
} as const

/**
 * Refusals that hold until a person changes billing or account state: resending
 * the same delivery cannot succeed, so an unattended sender that retries on a
 * non-2xx only loops. The reservation headroom denials belong here because their
 * policy already declares them non-retryable for unattended callers.
 */
const DETERMINISTIC_ADMISSION_REJECTION_CODES: ReadonlySet<string> = new Set([
  ADMISSION_REJECTION_CODE.USAGE_LIMIT_EXCEEDED,
  ADMISSION_REJECTION_CODE.ACCOUNT_SUSPENDED,
  ADMISSION_REJECTION_CODE.BILLING_ACCOUNT_REQUIRED,
  ADMISSION_ERROR_CODE.RESERVATION_PAYER_HEADROOM,
  ADMISSION_ERROR_CODE.RESERVATION_MEMBER_HEADROOM,
])

/** The failure's code when it is a deterministic admission rejection, else `undefined`. */
export function getDeterministicAdmissionRejectionCode(failure: {
  code?: unknown
}): string | undefined {
  return typeof failure.code === 'string' &&
    DETERMINISTIC_ADMISSION_REJECTION_CODES.has(failure.code)
    ? failure.code
    : undefined
}
