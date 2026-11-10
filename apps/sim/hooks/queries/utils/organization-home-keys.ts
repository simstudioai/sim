/**
 * Home's widget reads for one organization. Their own root, not the organization's accounts: an
 * account setting change does not refetch the viewer's mail, while connecting or disconnecting an
 * account invalidates Home explicitly.
 */
export const organizationHomeKeys = {
  all: ['organization-home'] as const,
  organization: (organizationId: string) => [...organizationHomeKeys.all, organizationId] as const,
  email: (organizationId: string) =>
    [...organizationHomeKeys.organization(organizationId), 'email'] as const,
  calendar: (organizationId: string, date: string, timeZone: string) =>
    [...organizationHomeKeys.organization(organizationId), 'calendar', date, timeZone] as const,
  workspaceActivity: (organizationId: string) =>
    [...organizationHomeKeys.organization(organizationId), 'workspace-activity'] as const,
}
