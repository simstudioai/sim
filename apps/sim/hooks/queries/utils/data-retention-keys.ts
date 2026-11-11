export const DATA_RETENTION_STALE_TIME = 60 * 1000

export const dataRetentionKeys = {
  all: ['dataRetention'] as const,
  settings: (orgId: string) => [...dataRetentionKeys.all, 'settings', orgId] as const,
}
