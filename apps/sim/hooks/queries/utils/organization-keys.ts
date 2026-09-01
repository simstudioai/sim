export const organizationKeys = {
  all: ['organizations'] as const,
  lists: () => [...organizationKeys.all, 'list'] as const,
  details: () => [...organizationKeys.all, 'detail'] as const,
  detail: (id: string) => [...organizationKeys.details(), id] as const,
  subscription: (id: string) => [...organizationKeys.detail(id), 'subscription'] as const,
  billing: (id: string) => [...organizationKeys.detail(id), 'billing'] as const,
  billingSummary: (id: string) => [...organizationKeys.billing(id), 'summary'] as const,
  members: (id: string) => [...organizationKeys.detail(id), 'members'] as const,
  memberUsage: (id: string) => [...organizationKeys.detail(id), 'member-usage'] as const,
  memberUsageLimit: (id: string, userId: string) =>
    [...organizationKeys.detail(id), 'member-usage-limit', userId] as const,
  roster: (id: string) => [...organizationKeys.detail(id), 'roster'] as const,
  removalImpact: (id: string, userId: string) =>
    [...organizationKeys.detail(id), 'removal-impact', userId] as const,
}
