/**
 * React Query key factory for the per-workspace credit and usage-gate reads.
 *
 * Standalone for the same reason as {@link file://./subscription-keys.ts}: the shared
 * billing invalidations need these keys without importing the hooks that call them.
 */
export const workspaceUsageKeys = {
  all: ['workspace-usage'] as const,
  creditAvailabilities: () => [...workspaceUsageKeys.all, 'credit-availability'] as const,
  creditAvailability: (workspaceId: string) =>
    [...workspaceUsageKeys.creditAvailabilities(), workspaceId] as const,
  gates: () => [...workspaceUsageKeys.all, 'gate'] as const,
  gate: (workspaceId: string) => [...workspaceUsageKeys.gates(), workspaceId] as const,
}
