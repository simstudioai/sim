import type { BatchInvitationResult } from '@/lib/api/contracts/invitations'

/** Distinct failure reasons listed in full before the remainder is counted instead. */
const MAX_LISTED_FAILURE_REASONS = 3

/**
 * Builds the submit error for a batch where some or all invitations failed.
 *
 * The server rejects per email and every reason names its own address, so the
 * reasons are listed rather than collapsed to the first one: inviting several
 * people who are all ineligible for the chosen membership is the common
 * multi-failure case, and reporting one of them hides who else needs attention.
 * Identical reasons are deduplicated, and beyond
 * {@link MAX_LISTED_FAILURE_REASONS} the tail is counted rather than listed so a
 * large batch cannot bury the modal in near-identical sentences.
 */
export function buildInviteFailureMessage(
  failures: BatchInvitationResult['failed'],
  attemptedCount: number
): string {
  if (failures.length === 1) return failures[0].error

  const headline =
    failures.length >= attemptedCount
      ? `None of the ${failures.length} invitations could be sent.`
      : `${failures.length} of ${attemptedCount} invitations could not be sent.`

  const reasons = [...new Set(failures.map((failure) => failure.error))]
  const listed = reasons.slice(0, MAX_LISTED_FAILURE_REASONS)
  const remaining = reasons.length - listed.length

  return [headline, ...listed, remaining > 0 ? `And ${remaining} more.` : null]
    .filter(Boolean)
    .join(' ')
}
