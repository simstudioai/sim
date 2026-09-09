import type { OrganizationDelegatedPrincipal } from '@sim/auth/principal'

/** Creates narrowly scoped, short-lived authority for a current verified Slack sender. */
export function slackSearchMemberPrincipal(
  event: { installationId: string; message: { eventId: string } },
  organizationId: string,
  userId: string
): OrganizationDelegatedPrincipal {
  const issuedAt = new Date()
  return {
    kind: 'organization_delegated',
    serviceId: 'slack-search',
    organizationId,
    subjectUserId: userId,
    delegationId: `${event.installationId}:${event.message.eventId}`,
    audience: 'sim:knowledge',
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + 60_000),
    resourceScope: { installationId: event.installationId, eventId: event.message.eventId },
  }
}
