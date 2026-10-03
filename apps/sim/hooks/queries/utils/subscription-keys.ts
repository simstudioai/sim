/**
 * React Query key factory for subscription and billing reads. Standalone so the shared
 * billing invalidations can use it without closing an import cycle through the hook module.
 */
export const subscriptionKeys = {
  all: ['subscription'] as const,
  users: () => [...subscriptionKeys.all, 'user'] as const,
  user: (includeOrg?: boolean) => [...subscriptionKeys.users(), { includeOrg }] as const,
  usage: () => [...subscriptionKeys.all, 'usage'] as const,
  invoicesAll: () => [...subscriptionKeys.all, 'invoices'] as const,
  invoices: (context: 'user' | 'organization' = 'user', organizationId?: string) =>
    [...subscriptionKeys.invoicesAll(), context, organizationId ?? ''] as const,
}
