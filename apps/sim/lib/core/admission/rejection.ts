/**
 * Codes for admission refusals that hold until a person changes billing or
 * account state, carried on the preprocessing error next to
 * `WORKFLOW_NOT_DEPLOYED_CODE`. Resending the same delivery cannot succeed, so
 * an unattended sender that retries on a non-2xx only loops.
 *
 * Reservation headroom denials are deliberately absent: they clear as in-flight
 * runs settle, so a retry can succeed. So is a usage ledger that could not be
 * read, which fails closed without saying anything about the payer.
 */
export const ADMISSION_REJECTION_CODE = {
  USAGE_LIMIT_EXCEEDED: 'USAGE_LIMIT_EXCEEDED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  BILLING_ACCOUNT_REQUIRED: 'BILLING_ACCOUNT_REQUIRED',
} as const

const DETERMINISTIC_ADMISSION_REJECTION_CODES: ReadonlySet<unknown> = new Set(
  Object.values(ADMISSION_REJECTION_CODE)
)

/** The failure's code when it is a deterministic admission rejection, else `undefined`. */
export function getDeterministicAdmissionRejectionCode(failure: {
  code?: unknown
}): string | undefined {
  return typeof failure.code === 'string' &&
    DETERMINISTIC_ADMISSION_REJECTION_CODES.has(failure.code)
    ? failure.code
    : undefined
}
