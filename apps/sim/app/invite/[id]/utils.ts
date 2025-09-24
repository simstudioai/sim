export function getErrorMessage(reason: string): string {
  switch (reason) {
    case 'missing-token':
      return 'The invitation link is invalid or missing a required parameter.'
    case 'invalid-token':
      return 'The invitation link is invalid or has already been used.'
    case 'expired':
      return 'This invitation has expired. Please ask for a new invitation.'
    case 'already-processed':
      return 'This invitation has already been accepted or declined.'
    case 'email-mismatch':
      return 'This invitation was sent to a different email address. Please log in with the correct account.'
    case 'workspace-not-found':
      return 'The workspace associated with this invitation could not be found.'
    case 'user-not-found':
      return 'Your user account could not be found. Please try logging out and logging back in.'
    case 'already-member':
      return 'You are already a member of this organization or workspace.'
    case 'already-in-organization':
      return 'You are already a member of an organization. Leave your current organization before accepting a new invitation.'
    case 'invalid-invitation':
      return 'This invitation is invalid or no longer exists.'
    case 'missing-invitation-id':
      return 'The invitation link is missing required information. Please use the original invitation link.'
    case 'server-error':
      return 'An unexpected error occurred while processing your invitation. Please try again later.'
    default:
      return 'An unknown error occurred while processing your invitation.'
  }
}
