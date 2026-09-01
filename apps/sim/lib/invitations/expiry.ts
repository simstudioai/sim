export const INVITATION_EXPIRY_DAYS = 7

export function computeInvitationExpiry(daysFromNow = INVITATION_EXPIRY_DAYS): Date {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000)
}
