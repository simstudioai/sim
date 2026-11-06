import type { BatchInvitationResult } from '@/lib/api/contracts/invitations'

/**
 * Human-readable copy for invitation accept/decline failures. The accept and
 * reject routes return `{ error: <kind> }` where `<kind>` is a machine code
 * (e.g. `no-seats-available`); `requestJson` surfaces that raw code as the
 * thrown error's `message`. In-app surfaces (the workspace-switcher
 * invitations modal) map the code through here so users see a sentence, not a
 * kebab-case token. The full-page `/invite` flow has its own richer map (with
 * retry/auth affordances); this is the message-only slice for the in-app path.
 */
const INVITATION_ERROR_MESSAGES: Record<string, string> = {
  'not-found': 'This invitation is invalid or no longer exists.',
  'invalid-token': 'This invitation link is invalid or has already been used.',
  expired: 'This invitation has expired. Ask for a new one.',
  'already-processed': 'This invitation has already been accepted or declined.',
  'email-mismatch': 'This invitation was sent to a different email address.',
  'already-in-organization':
    'You are already in an organization. Leave it before accepting a new invitation.',
  'no-seats-available':
    'This organization has reached its seat limit. Ask an admin to add seats, then try again.',
  'upgrade-required':
    'The workspace owner needs an active paid plan before you can join. Ask them to update it, then try again.',
  'external-requires-paid-plan':
    'External collaborators need their own paid Sim plan. Upgrade your plan, or ask the organization to re-invite you as a member — that uses one of their seats instead.',
  'disclosure-outdated':
    'What accepting does changed since this list loaded. Reopen your invitations to see the updated details, then accept again.',
  'workspace-not-found': 'The workspace this invitation points at could not be found.',
  'server-error': 'Something went wrong processing the invitation. Please try again.',
}

/**
 * Maps an invitation error code (the thrown message from a failed accept/reject
 * request) to friendly copy, falling back to `fallback` for unknown codes such
 * as network errors.
 */
export function getInvitationErrorMessage(code: string, fallback: string): string {
  return INVITATION_ERROR_MESSAGES[code] ?? fallback
}

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
