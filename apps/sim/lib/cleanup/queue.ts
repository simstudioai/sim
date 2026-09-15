/** Logs and soft deletes share one lane, including legacy scheduled runs. */
export const retentionCleanupQueue = { name: 'retention-cleanup', concurrencyLimit: 1 }
