/**
 * React Query key factory for subscription and billing reads.
 *
 * Lives in this standalone module — like {@link file://./workspace-usage-keys.ts} — so
 * the shared billing invalidations can reference it without importing the hook module
 * that consumes those invalidations, which would close an import cycle between the two.
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
