export const SESSION_POLICY_STALE_TIME = 60 * 1000

export const sessionPolicyKeys = {
  all: ['sessionPolicy'] as const,
  settings: (orgId: string) => [...sessionPolicyKeys.all, 'settings', orgId] as const,
}
