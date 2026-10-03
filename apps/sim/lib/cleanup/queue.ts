import { queue } from '@trigger.dev/sdk'
export const retentionCleanupQueue = queue({ name: 'retention-cleanup', concurrencyLimit: 1 })
