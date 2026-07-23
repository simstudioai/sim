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
